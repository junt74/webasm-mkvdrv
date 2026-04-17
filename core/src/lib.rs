use core::f32::consts::TAU;

const INIT_MESSAGE: &[u8] = b"MKVDRV-Wasm core initialized";
const WAVETABLE_CAPACITY: usize = 2048;

static mut WAVETABLE: [f32; WAVETABLE_CAPACITY] = [0.0; WAVETABLE_CAPACITY];

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
}
