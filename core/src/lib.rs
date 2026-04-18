mod mml;

use core::f32::consts::TAU;
use core::str;

use mml::parse_mml;

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
pub extern "C" fn mkvdrv_parse_mml_from_buffer(input_len: usize) -> usize {
    let len = input_len.min(MML_INPUT_CAPACITY);
    let source = unsafe { str::from_utf8_unchecked(&MML_INPUT_BUFFER[..len]) };
    fill_sequence_events_from_mml(source).unwrap_or_default()
}

#[unsafe(no_mangle)]
pub extern "C" fn mkvdrv_fill_demo_sequence() -> usize {
    fill_sequence_events_from_mml(DEMO_MML).unwrap_or_default()
}

fn fill_sequence_events_from_mml(source: &str) -> Result<usize, mml::ParseError> {
    let parsed = parse_mml(source, SEQUENCE_EVENT_CAPACITY)?;

    for (index, event) in parsed.events.iter().enumerate() {
        write_event(index, event.kind, event.value, event.length_ticks);
    }

    Ok(parsed.events.len())
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

    #[test]
    fn returns_init_message() {
        let message = str::from_utf8(INIT_MESSAGE).expect("valid UTF-8");
        assert_eq!(message, "MKVDRV-Wasm core initialized");
    }

    #[test]
    fn fills_wavetable() {
        let len = mkvdrv_fill_sine_wavetable(32);

        assert_eq!(len, 32);

        let first = unsafe { WAVETABLE[0] };
        let quarter = unsafe { WAVETABLE[8] };

        assert!(first.abs() < 1.0e-6);
        assert!((quarter - 1.0).abs() < 1.0e-3);
    }

    #[test]
    fn fills_note_frequencies() {
        let len = mkvdrv_fill_note_frequencies();

        assert_eq!(len, NOTE_FREQUENCY_CAPACITY);

        let a4 = unsafe { NOTE_FREQUENCIES[A4_INDEX as usize] };
        let c5 = unsafe { NOTE_FREQUENCIES[72] };

        assert!((a4 - 440.0).abs() < 1.0e-6);
        assert!((c5 - 523.251).abs() < 0.02);
    }

    #[test]
    fn fills_demo_sequence_from_mml() {
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
}
