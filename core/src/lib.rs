use core::f32::consts::TAU;

const INIT_MESSAGE: &[u8] = b"MKVDRV-Wasm core initialized";
const WAVETABLE_CAPACITY: usize = 2048;
const NOTE_FREQUENCY_CAPACITY: usize = 128;
const A4_INDEX: i32 = 69;
const A4_FREQUENCY: f32 = 440.0;

static mut WAVETABLE: [f32; WAVETABLE_CAPACITY] = [0.0; WAVETABLE_CAPACITY];
static mut NOTE_FREQUENCIES: [f32; NOTE_FREQUENCY_CAPACITY] = [0.0; NOTE_FREQUENCY_CAPACITY];

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
}
