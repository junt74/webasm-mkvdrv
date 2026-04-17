use core::f32::consts::TAU;

const INIT_MESSAGE: &[u8] = b"MKVDRV-Wasm core initialized";
const WAVETABLE_CAPACITY: usize = 2048;
const NOTE_FREQUENCY_CAPACITY: usize = 128;
const SEQUENCE_EVENT_STRIDE: usize = 3;
const SEQUENCE_EVENT_CAPACITY: usize = 64;
const SEQUENCE_TICKS_PER_STEP: u32 = 24;
const SEQUENCE_TICKS_PER_BEAT: u32 = SEQUENCE_TICKS_PER_STEP * 4;
const A4_INDEX: i32 = 69;
const A4_FREQUENCY: f32 = 440.0;
const EVENT_NOTE_ON: u32 = 1;
const EVENT_NOTE_OFF: u32 = 2;

static mut WAVETABLE: [f32; WAVETABLE_CAPACITY] = [0.0; WAVETABLE_CAPACITY];
static mut NOTE_FREQUENCIES: [f32; NOTE_FREQUENCY_CAPACITY] = [0.0; NOTE_FREQUENCY_CAPACITY];
static mut SEQUENCE_EVENTS: [u32; SEQUENCE_EVENT_CAPACITY * SEQUENCE_EVENT_STRIDE] =
    [0; SEQUENCE_EVENT_CAPACITY * SEQUENCE_EVENT_STRIDE];

const DEMO_STEPS: &[(Option<u32>, u32)] = &[
    (Some(60), 1),
    (Some(64), 1),
    (Some(67), 1),
    (Some(72), 1),
    (Some(67), 1),
    (Some(64), 1),
    (Some(60), 2),
    (None, 1),
    (Some(62), 1),
    (Some(65), 1),
    (Some(69), 1),
    (Some(74), 1),
    (Some(69), 1),
    (Some(65), 1),
    (Some(62), 2),
    (None, 1),
];

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
pub extern "C" fn mkvdrv_fill_demo_sequence() -> usize {
    let mut event_count = 0;

    for (note, step_length) in DEMO_STEPS {
        let total_ticks = step_length * SEQUENCE_TICKS_PER_STEP;

        match note {
            Some(note_value) => {
                let gate_ticks = total_ticks * 3 / 4;
                let release_ticks = total_ticks.saturating_sub(gate_ticks);

                if event_count + 2 > SEQUENCE_EVENT_CAPACITY {
                    break;
                }

                write_event(event_count, EVENT_NOTE_ON, *note_value, gate_ticks.max(1));
                event_count += 1;

                write_event(event_count, EVENT_NOTE_OFF, *note_value, release_ticks.max(1));
                event_count += 1;
            }
            None => {
                if event_count + 1 > SEQUENCE_EVENT_CAPACITY {
                    break;
                }

                write_event(event_count, EVENT_NOTE_OFF, 0, total_ticks.max(1));
                event_count += 1;
            }
        }
    }

    event_count
}

fn write_event(index: usize, event_kind: u32, note: u32, length_ticks: u32) {
    let base = index * SEQUENCE_EVENT_STRIDE;

    unsafe {
        SEQUENCE_EVENTS[base] = event_kind;
        SEQUENCE_EVENTS[base + 1] = note;
        SEQUENCE_EVENTS[base + 2] = length_ticks;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_init_message() {
        let message = core::str::from_utf8(INIT_MESSAGE).expect("valid UTF-8");
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
    fn fills_demo_sequence_events() {
        let event_count = mkvdrv_fill_demo_sequence();

        assert!(event_count > 0);
        assert_eq!(unsafe { SEQUENCE_EVENTS[0] }, EVENT_NOTE_ON);
        assert_eq!(unsafe { SEQUENCE_EVENTS[1] }, 60);
        assert_eq!(unsafe { SEQUENCE_EVENTS[2] }, 18);

        let second_event_base = SEQUENCE_EVENT_STRIDE;
        assert_eq!(unsafe { SEQUENCE_EVENTS[second_event_base] }, EVENT_NOTE_OFF);
        assert_eq!(unsafe { SEQUENCE_EVENTS[second_event_base + 2] }, 6);
    }
}
