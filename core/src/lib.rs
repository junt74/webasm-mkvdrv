mod mml;

use core::f32::consts::TAU;
use core::str;

use mml::{
    collect_parse_diagnostics_with_context, format_parse_failure_with_context,
    parse_failure_quick_fixes, parse_mml_with_context, ParseFailure,
};

#[cfg(test)]
use mml::{EVENT_NOTE_OFF, EVENT_NOTE_ON, EVENT_TEMPO};

const INIT_MESSAGE: &[u8] = b"MKVDRV-Wasm core initialized";
const WAVETABLE_CAPACITY: usize = 2048;
const NOTE_FREQUENCY_CAPACITY: usize = 128;
const SEQUENCE_EVENT_STRIDE: usize = 3;
const SEQUENCE_EVENT_CAPACITY: usize = 128;
const SEQUENCE_TICKS_PER_BEAT: u32 = 24;
const MML_INPUT_CAPACITY: usize = 4096;
const A4_INDEX: i32 = 69;
const A4_FREQUENCY: f32 = 440.0;

static mut WAVETABLE: [f32; WAVETABLE_CAPACITY] = [0.0; WAVETABLE_CAPACITY];
static mut NOTE_FREQUENCIES: [f32; NOTE_FREQUENCY_CAPACITY] = [0.0; NOTE_FREQUENCY_CAPACITY];
static mut SEQUENCE_EVENTS: [u32; SEQUENCE_EVENT_CAPACITY * SEQUENCE_EVENT_STRIDE] =
    [0; SEQUENCE_EVENT_CAPACITY * SEQUENCE_EVENT_STRIDE];
static mut MML_INPUT_BUFFER: [u8; MML_INPUT_CAPACITY] = [0; MML_INPUT_CAPACITY];
const LAST_PARSE_ERROR_MESSAGE_CAPACITY: usize = 256;
const PARSE_DIAGNOSTIC_CAPACITY: usize = 16;
const PARSE_DIAGNOSTIC_MESSAGE_CAPACITY: usize = 128;
const PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY: usize = 3;
const PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY: usize = 48;
const PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY: usize = 128;
static mut LAST_PARSE_ERROR_MESSAGE: [u8; LAST_PARSE_ERROR_MESSAGE_CAPACITY] =
    [0; LAST_PARSE_ERROR_MESSAGE_CAPACITY];
static mut LAST_PARSE_ERROR_MESSAGE_LEN: usize = 0;
static mut LAST_PARSE_ERROR_POSITION: usize = 0;
static mut PARSE_DIAGNOSTIC_COUNT: usize = 0;
static mut PARSE_DIAGNOSTIC_POSITIONS: [usize; PARSE_DIAGNOSTIC_CAPACITY] = [0; PARSE_DIAGNOSTIC_CAPACITY];
static mut PARSE_DIAGNOSTIC_ENDS: [usize; PARSE_DIAGNOSTIC_CAPACITY] = [0; PARSE_DIAGNOSTIC_CAPACITY];
static mut PARSE_DIAGNOSTIC_RELATED_POSITIONS: [usize; PARSE_DIAGNOSTIC_CAPACITY] =
    [usize::MAX; PARSE_DIAGNOSTIC_CAPACITY];
static mut PARSE_DIAGNOSTIC_MESSAGE_LENS: [usize; PARSE_DIAGNOSTIC_CAPACITY] =
    [0; PARSE_DIAGNOSTIC_CAPACITY];
static mut PARSE_DIAGNOSTIC_QUICK_FIX_COUNTS: [usize; PARSE_DIAGNOSTIC_CAPACITY] =
    [0; PARSE_DIAGNOSTIC_CAPACITY];
static mut PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_LENS: [usize;
    PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY] =
    [0; PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY];
static mut PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_LENS: [usize;
    PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY] =
    [0; PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY];
static mut PARSE_DIAGNOSTIC_MESSAGES: [u8; PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_MESSAGE_CAPACITY] =
    [0; PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_MESSAGE_CAPACITY];
static mut PARSE_DIAGNOSTIC_QUICK_FIX_LABELS: [u8;
    PARSE_DIAGNOSTIC_CAPACITY
        * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY
        * PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY] =
    [0;
        PARSE_DIAGNOSTIC_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY];
static mut PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENTS: [u8;
    PARSE_DIAGNOSTIC_CAPACITY
        * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY
        * PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY] =
    [0;
        PARSE_DIAGNOSTIC_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY];
static mut CONDITIONAL_BRANCH_INDEX: usize = 0;

const DEMO_MML: &str = "t124 o4 l16 ceg>c<g e c r dfa>b<a f d r";

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_init_message_ptr() -> *const u8 {
    INIT_MESSAGE.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_init_message_len() -> usize {
    INIT_MESSAGE.len()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_wavetable_ptr() -> *const f32 {
    core::ptr::addr_of!(WAVETABLE).cast::<f32>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_fill_sine_wavetable(requested_len: usize) -> usize {
    let len = requested_len.min(WAVETABLE_CAPACITY).max(1);

    for index in 0..len {
        let phase = (index as f32 / len as f32) * TAU;

        unsafe {
            WAVETABLE[index] = phase.sin();
        }
    }

    len
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_note_frequencies_ptr() -> *const f32 {
    core::ptr::addr_of!(NOTE_FREQUENCIES).cast::<f32>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_fill_note_frequencies() -> usize {
    for note_index in 0..NOTE_FREQUENCY_CAPACITY {
        let semitone_offset = note_index as i32 - A4_INDEX;
        let frequency = A4_FREQUENCY * 2.0_f32.powf(semitone_offset as f32 / 12.0);

        unsafe {
            NOTE_FREQUENCIES[note_index] = frequency;
        }
    }

    NOTE_FREQUENCY_CAPACITY
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_sequence_events_ptr() -> *const u32 {
    core::ptr::addr_of!(SEQUENCE_EVENTS).cast::<u32>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_sequence_event_stride() -> usize {
    SEQUENCE_EVENT_STRIDE
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_sequence_ticks_per_beat() -> u32 {
    SEQUENCE_TICKS_PER_BEAT
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_mml_input_buffer_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(MML_INPUT_BUFFER).cast::<u8>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_mml_input_buffer_capacity() -> usize {
    MML_INPUT_CAPACITY
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_set_conditional_branch_index(branch_index: usize) {
    unsafe {
        CONDITIONAL_BRANCH_INDEX = branch_index;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_conditional_branch_index() -> usize {
    unsafe { CONDITIONAL_BRANCH_INDEX }
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_last_parse_error_message_ptr() -> *const u8 {
    core::ptr::addr_of!(LAST_PARSE_ERROR_MESSAGE).cast::<u8>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_last_parse_error_message_len() -> usize {
    unsafe { LAST_PARSE_ERROR_MESSAGE_LEN }
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_last_parse_error_position() -> usize {
    unsafe { LAST_PARSE_ERROR_POSITION }
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_count() -> usize {
    unsafe { PARSE_DIAGNOSTIC_COUNT }
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_positions_ptr() -> *const usize {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_POSITIONS).cast::<usize>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_ends_ptr() -> *const usize {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_ENDS).cast::<usize>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_related_positions_ptr() -> *const usize {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_RELATED_POSITIONS).cast::<usize>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_message_lens_ptr() -> *const usize {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_MESSAGE_LENS).cast::<usize>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_counts_ptr() -> *const usize {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_QUICK_FIX_COUNTS).cast::<usize>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_messages_ptr() -> *const u8 {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_MESSAGES).cast::<u8>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_label_lens_ptr() -> *const usize {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_LENS).cast::<usize>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_replacement_lens_ptr() -> *const usize {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_LENS).cast::<usize>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_labels_ptr() -> *const u8 {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_QUICK_FIX_LABELS).cast::<u8>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_replacements_ptr() -> *const u8 {
    core::ptr::addr_of!(PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENTS).cast::<u8>()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_message_stride() -> usize {
    PARSE_DIAGNOSTIC_MESSAGE_CAPACITY
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_slot_count() -> usize {
    PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_label_stride() -> usize {
    PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_diagnostic_quick_fix_replacement_stride() -> usize {
    PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_parse_mml_from_buffer(input_len: usize) -> usize {
    let len = input_len.min(MML_INPUT_CAPACITY);
    let source = unsafe { str::from_utf8_unchecked(&MML_INPUT_BUFFER[..len]) };
    fill_sequence_events_from_mml(source).unwrap_or_else(|error| {
        store_parse_failures(source, &error);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_fill_demo_sequence() -> usize {
    fill_sequence_events_from_mml(DEMO_MML).unwrap_or_else(|error| {
        store_parse_failures(DEMO_MML, &error);
        0
    })
}

fn fill_sequence_events_from_mml(source: &str) -> Result<usize, ParseFailure> {
    let branch_index = unsafe { CONDITIONAL_BRANCH_INDEX };
    let parsed = parse_mml_with_context(source, SEQUENCE_EVENT_CAPACITY, branch_index)?;

    for (index, event) in parsed.events.iter().enumerate() {
        write_event(index, event.kind, event.value, event.length_ticks);
    }

    clear_parse_failure();
    Ok(parsed.events.len())
}

fn clear_parse_failure() {
    unsafe {
        LAST_PARSE_ERROR_MESSAGE_LEN = 0;
        LAST_PARSE_ERROR_POSITION = 0;
        PARSE_DIAGNOSTIC_COUNT = 0;
        for index in 0..LAST_PARSE_ERROR_MESSAGE_CAPACITY {
            LAST_PARSE_ERROR_MESSAGE[index] = 0;
        }
        for index in 0..PARSE_DIAGNOSTIC_CAPACITY {
            PARSE_DIAGNOSTIC_POSITIONS[index] = 0;
            PARSE_DIAGNOSTIC_ENDS[index] = 0;
            PARSE_DIAGNOSTIC_RELATED_POSITIONS[index] = usize::MAX;
            PARSE_DIAGNOSTIC_MESSAGE_LENS[index] = 0;
            PARSE_DIAGNOSTIC_QUICK_FIX_COUNTS[index] = 0;
        }
        for index in 0..(PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_MESSAGE_CAPACITY) {
            PARSE_DIAGNOSTIC_MESSAGES[index] = 0;
        }
        for index in 0..(PARSE_DIAGNOSTIC_CAPACITY * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY) {
            PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_LENS[index] = 0;
            PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_LENS[index] = 0;
        }
        for index in 0..(PARSE_DIAGNOSTIC_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY)
        {
            PARSE_DIAGNOSTIC_QUICK_FIX_LABELS[index] = 0;
        }
        for index in 0..(PARSE_DIAGNOSTIC_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY
            * PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY)
        {
            PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENTS[index] = 0;
        }
    }
}

fn store_parse_failures(source: &str, primary_error: &ParseFailure) {
    let branch_index = unsafe { CONDITIONAL_BRANCH_INDEX };
    let diagnostics =
        collect_parse_diagnostics_with_context(source, SEQUENCE_EVENT_CAPACITY, branch_index);
    let first_error = diagnostics.first().unwrap_or(primary_error);

    store_last_parse_failure(source, first_error, branch_index);
    store_parse_diagnostics(source, &diagnostics, branch_index);
}

fn store_last_parse_failure(source: &str, error: &ParseFailure, branch_index: usize) {
    let message = format_parse_failure_with_context(source, error, branch_index);
    let bytes = message.as_bytes();
    let copy_len = bytes.len().min(LAST_PARSE_ERROR_MESSAGE_CAPACITY);

    unsafe {
        for index in 0..LAST_PARSE_ERROR_MESSAGE_CAPACITY {
            LAST_PARSE_ERROR_MESSAGE[index] = 0;
        }
        for (index, byte) in bytes.iter().take(copy_len).enumerate() {
            LAST_PARSE_ERROR_MESSAGE[index] = *byte;
        }
        LAST_PARSE_ERROR_MESSAGE_LEN = copy_len;
        LAST_PARSE_ERROR_POSITION = error.position;
    }
}

fn store_parse_diagnostics(source: &str, diagnostics: &[ParseFailure], branch_index: usize) {
    let count = diagnostics.len().min(PARSE_DIAGNOSTIC_CAPACITY);

    unsafe {
        PARSE_DIAGNOSTIC_COUNT = count;
    }

    for (index, diagnostic) in diagnostics.iter().take(count).enumerate() {
        let start = index * PARSE_DIAGNOSTIC_MESSAGE_CAPACITY;
        let end = start + PARSE_DIAGNOSTIC_MESSAGE_CAPACITY;
        let message = format_parse_failure_with_context(source, diagnostic, branch_index);
        let bytes = message.as_bytes();
        let copy_len = bytes.len().min(PARSE_DIAGNOSTIC_MESSAGE_CAPACITY);
        let quick_fixes = parse_failure_quick_fixes(source, diagnostic);

        unsafe {
            PARSE_DIAGNOSTIC_POSITIONS[index] = diagnostic.position;
            PARSE_DIAGNOSTIC_ENDS[index] = diagnostic.span_end(source);
            PARSE_DIAGNOSTIC_RELATED_POSITIONS[index] =
                diagnostic.related_position.unwrap_or(usize::MAX);
            PARSE_DIAGNOSTIC_MESSAGE_LENS[index] = copy_len;
            PARSE_DIAGNOSTIC_QUICK_FIX_COUNTS[index] =
                quick_fixes.len().min(PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY);

            for slot in start..end {
                PARSE_DIAGNOSTIC_MESSAGES[slot] = 0;
            }

            for (offset, byte) in bytes.iter().take(copy_len).enumerate() {
                PARSE_DIAGNOSTIC_MESSAGES[start + offset] = *byte;
            }

            for slot_index in 0..PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY {
                let flat_index = index * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY + slot_index;
                let label_start = flat_index * PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY;
                let label_end = label_start + PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY;
                let replacement_start =
                    flat_index * PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY;
                let replacement_end =
                    replacement_start + PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY;

                PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_LENS[flat_index] = 0;
                PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_LENS[flat_index] = 0;

                for slot in label_start..label_end {
                    PARSE_DIAGNOSTIC_QUICK_FIX_LABELS[slot] = 0;
                }
                for slot in replacement_start..replacement_end {
                    PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENTS[slot] = 0;
                }
            }

            for (slot_index, quick_fix) in quick_fixes
                .iter()
                .take(PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY)
                .enumerate()
            {
                let flat_index = index * PARSE_DIAGNOSTIC_QUICK_FIX_SLOT_CAPACITY + slot_index;
                let label_start = flat_index * PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY;
                let replacement_start =
                    flat_index * PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY;
                let label_bytes = quick_fix.label.as_bytes();
                let replacement_bytes = quick_fix.replacement.as_bytes();
                let label_len = label_bytes.len().min(PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_CAPACITY);
                let replacement_len = replacement_bytes
                    .len()
                    .min(PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY);

                PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_LENS[flat_index] = label_len;
                PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_LENS[flat_index] = replacement_len;

                for (offset, byte) in label_bytes.iter().take(label_len).enumerate() {
                    PARSE_DIAGNOSTIC_QUICK_FIX_LABELS[label_start + offset] = *byte;
                }
                for (offset, byte) in replacement_bytes.iter().take(replacement_len).enumerate() {
                    PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENTS[replacement_start + offset] = *byte;
                }
            }
        }
    }
}

fn write_event(index: usize, event_kind: u32, value: u32, length_ticks: u32) {
    let base = index * SEQUENCE_EVENT_STRIDE;

    unsafe {
        SEQUENCE_EVENTS[base] = event_kind;
        SEQUENCE_EVENTS[base + 1] = value;
        SEQUENCE_EVENTS[base + 2] = length_ticks;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock_test_state() -> MutexGuard<'static, ()> {
        TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn returns_init_message() {
        let _guard = lock_test_state();
        let message = str::from_utf8(INIT_MESSAGE).expect("valid UTF-8");
        assert_eq!(message, "MKVDRV-Wasm core initialized");
    }

    #[test]
    fn fills_wavetable() {
        let _guard = lock_test_state();
        let len = mkvdrv_fill_sine_wavetable(32);

        assert_eq!(len, 32);

        let first = unsafe { WAVETABLE[0] };
        let quarter = unsafe { WAVETABLE[8] };

        assert!(first.abs() < 1.0e-6);
        assert!((quarter - 1.0).abs() < 1.0e-3);
    }

    #[test]
    fn fills_note_frequencies() {
        let _guard = lock_test_state();
        let len = mkvdrv_fill_note_frequencies();

        assert_eq!(len, NOTE_FREQUENCY_CAPACITY);

        let a4 = unsafe { NOTE_FREQUENCIES[A4_INDEX as usize] };
        let c5 = unsafe { NOTE_FREQUENCIES[72] };

        assert!((a4 - 440.0).abs() < 1.0e-6);
        assert!((c5 - 523.251).abs() < 0.02);
    }

    #[test]
    fn fills_demo_sequence_from_mml() {
        let _guard = lock_test_state();
        let event_count = mkvdrv_fill_demo_sequence();

        assert!(event_count >= 3);
        assert_eq!(unsafe { SEQUENCE_EVENTS[0] }, EVENT_TEMPO);
        assert_eq!(unsafe { SEQUENCE_EVENTS[1] }, 124);

        let first_note_base = SEQUENCE_EVENT_STRIDE;
        assert_eq!(unsafe { SEQUENCE_EVENTS[first_note_base] }, EVENT_NOTE_ON);
        assert_eq!(unsafe { SEQUENCE_EVENTS[first_note_base + 1] }, 36);
        assert_eq!(unsafe { SEQUENCE_EVENTS[first_note_base + 2] }, 6);

        let first_note_off_base = SEQUENCE_EVENT_STRIDE * 2;
        assert_eq!(unsafe { SEQUENCE_EVENTS[first_note_off_base] }, EVENT_NOTE_OFF);
        assert_eq!(unsafe { SEQUENCE_EVENTS[first_note_off_base + 1] }, 36);
    }

    #[test]
    fn parses_mml_from_buffer() {
        let _guard = lock_test_state();
        let input = b"t150 o4 l8 c r d";

        unsafe {
            MML_INPUT_BUFFER[..input.len()].copy_from_slice(input);
        }

        let event_count = mkvdrv_parse_mml_from_buffer(input.len());

        assert_eq!(event_count, 6);
        assert_eq!(unsafe { SEQUENCE_EVENTS[0] }, EVENT_TEMPO);
        assert_eq!(unsafe { SEQUENCE_EVENTS[1] }, 150);
        assert_eq!(unsafe { SEQUENCE_EVENTS[SEQUENCE_EVENT_STRIDE] }, EVENT_NOTE_ON);
        assert_eq!(unsafe { SEQUENCE_EVENTS[SEQUENCE_EVENT_STRIDE + 1] }, 36);
    }

    #[test]
    fn stores_last_parse_error_details() {
        let _guard = lock_test_state();
        let input = b"o4 C c";

        unsafe {
            MML_INPUT_BUFFER[..input.len()].copy_from_slice(input);
        }

        let event_count = mkvdrv_parse_mml_from_buffer(input.len());

        assert_eq!(event_count, 0);
        assert_eq!(mkvdrv_last_parse_error_position(), 3);

        let message = unsafe {
            str::from_utf8_unchecked(&LAST_PARSE_ERROR_MESSAGE[..mkvdrv_last_parse_error_message_len()])
        };
        assert!(message.contains("missing parameter for 'C'"));
        assert!(message.contains("ticks-per-whole expects a number"));
        assert_eq!(mkvdrv_parse_diagnostic_count(), 1);
        assert_eq!(unsafe { PARSE_DIAGNOSTIC_QUICK_FIX_COUNTS[0] }, 2);

        let first_label_len = unsafe { PARSE_DIAGNOSTIC_QUICK_FIX_LABEL_LENS[0] };
        let first_replacement_len = unsafe { PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_LENS[0] };
        let second_replacement_len = unsafe { PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_LENS[1] };
        let first_label = unsafe {
            str::from_utf8_unchecked(&PARSE_DIAGNOSTIC_QUICK_FIX_LABELS[..first_label_len])
        };
        let first_replacement = unsafe {
            str::from_utf8_unchecked(
                &PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENTS[..first_replacement_len],
            )
        };
        let second_replacement_start = PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENT_CAPACITY;
        let second_replacement = unsafe {
            str::from_utf8_unchecked(
                &PARSE_DIAGNOSTIC_QUICK_FIX_REPLACEMENTS[second_replacement_start
                    ..second_replacement_start + second_replacement_len],
            )
        };

        assert_eq!(first_label, "標準 ticks-per-whole");
        assert_eq!(first_replacement, "C96");
        assert_eq!(second_replacement, "C:96");
    }

    #[test]
    fn applies_conditional_branch_index_to_parse() {
        let _guard = lock_test_state();
        mkvdrv_set_conditional_branch_index(1);

        let input = b"o4 c{d/e/f}";

        unsafe {
            MML_INPUT_BUFFER[..input.len()].copy_from_slice(input);
        }

        let event_count = mkvdrv_parse_mml_from_buffer(input.len());

        assert_eq!(event_count, 4);
        assert_eq!(unsafe { SEQUENCE_EVENTS[SEQUENCE_EVENT_STRIDE * 2 + 1] }, 40);

        mkvdrv_set_conditional_branch_index(0);
    }

    #[test]
    fn stores_multiple_parse_diagnostics() {
        let _guard = lock_test_state();
        let input = b"o4 ] c { d";

        unsafe {
            MML_INPUT_BUFFER[..input.len()].copy_from_slice(input);
        }

        let event_count = mkvdrv_parse_mml_from_buffer(input.len());

        assert_eq!(event_count, 0);
        assert_eq!(mkvdrv_parse_diagnostic_count(), 2);
        assert_eq!(unsafe { PARSE_DIAGNOSTIC_POSITIONS[0] }, 3);
        assert_eq!(unsafe { PARSE_DIAGNOSTIC_POSITIONS[1] }, 7);
        assert_eq!(unsafe { PARSE_DIAGNOSTIC_RELATED_POSITIONS[1] }, 7);

        let first_len = unsafe { PARSE_DIAGNOSTIC_MESSAGE_LENS[0] };
        let first_message = unsafe {
            str::from_utf8_unchecked(&PARSE_DIAGNOSTIC_MESSAGES[..first_len])
        };
        assert!(first_message.contains("found loop close without a matching '['"));
    }

    #[test]
    fn stores_related_opening_position_for_parser_error() {
        let _guard = lock_test_state();
        mkvdrv_set_conditional_branch_index(0);
        let input = b"[c{x/e}]";

        unsafe {
            MML_INPUT_BUFFER[..input.len()].copy_from_slice(input);
        }

        let event_count = mkvdrv_parse_mml_from_buffer(input.len());

        assert_eq!(event_count, 0);
        assert_eq!(mkvdrv_parse_diagnostic_count(), 1);
        assert_eq!(unsafe { PARSE_DIAGNOSTIC_POSITIONS[0] }, 3);
        assert_eq!(unsafe { PARSE_DIAGNOSTIC_RELATED_POSITIONS[0] }, 2);
    }
}
