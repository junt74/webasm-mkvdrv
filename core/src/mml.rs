const DEFAULT_TICKS_PER_BEAT: u32 = 24;
const DEFAULT_TICKS_PER_WHOLE: u32 = DEFAULT_TICKS_PER_BEAT * 4;
const DEFAULT_NOTE_LENGTH: u32 = DEFAULT_TICKS_PER_WHOLE / 4;
const DEFAULT_TEMPO_BPM: u32 = 120;
const MML_OCTAVE_OFFSET: i32 = -1;
const DEFAULT_QUANTIZE_NUMERATOR: u32 = 8;
const DEFAULT_QUANTIZE_DENOMINATOR: u32 = 8;

pub const EVENT_NOTE_ON: u32 = 1;
pub const EVENT_NOTE_OFF: u32 = 2;
pub const EVENT_TEMPO: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SequenceEvent {
    pub kind: u32,
    pub value: u32,
    pub length_ticks: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSequence {
    pub ticks_per_beat: u32,
    pub events: Vec<SequenceEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedCharacter(char),
    MissingParameter(char),
    InvalidLength,
    InvalidTempo,
    InvalidOctave,
    InvalidQuantize,
    InvalidTie,
    InvalidSlur,
    TooManyEvents,
}

pub fn parse_mml(source: &str, max_events: usize) -> Result<ParsedSequence, ParseError> {
    let mut parser = Parser::new(source, max_events);
    parser.parse()?;
    Ok(ParsedSequence {
        ticks_per_beat: parser.ticks_per_beat,
        events: parser.events,
    })
}

struct Parser<'a> {
    chars: &'a [u8],
    index: usize,
    max_events: usize,
    ticks_per_beat: u32,
    ticks_per_whole: u32,
    default_length: u32,
    octave: i32,
    tempo_bpm: u32,
    quantize_numerator: u32,
    quantize_denominator: u32,
    early_release_ticks: u32,
    events: Vec<SequenceEvent>,
}

impl<'a> Parser<'a> {
    fn new(source: &'a str, max_events: usize) -> Self {
        Self {
            chars: source.as_bytes(),
            index: 0,
            max_events,
            ticks_per_beat: DEFAULT_TICKS_PER_BEAT,
            ticks_per_whole: DEFAULT_TICKS_PER_WHOLE,
            default_length: DEFAULT_NOTE_LENGTH,
            octave: 4 + MML_OCTAVE_OFFSET,
            tempo_bpm: DEFAULT_TEMPO_BPM,
            quantize_numerator: DEFAULT_QUANTIZE_NUMERATOR,
            quantize_denominator: DEFAULT_QUANTIZE_DENOMINATOR,
            early_release_ticks: 0,
            events: Vec::new(),
        }
    }

    fn parse(&mut self) -> Result<(), ParseError> {
        while let Some(byte) = self.peek() {
            match byte {
                b' ' | b'\t' | b'\n' | b'\r' | b'|' => {
                    self.index += 1;
                }
                b';' => {
                    self.skip_comment();
                }
                b't' => {
                    self.index += 1;
                    let tempo = self.read_required_number('t')?;
                    if tempo == 0 {
                        return Err(ParseError::InvalidTempo);
                    }
                    self.tempo_bpm = tempo;
                    self.push_event(EVENT_TEMPO, tempo, 0)?;
                }
                b'l' => {
                    self.index += 1;
                    self.default_length = self.read_duration()?;
                }
                b'C' => {
                    self.index += 1;
                    let ticks = self.read_tick_parameter('C')?;
                    if ticks == 0 {
                        return Err(ParseError::InvalidLength);
                    }
                    self.ticks_per_whole = ticks;
                }
                b'o' => {
                    self.index += 1;
                    let octave = self.read_required_number('o')? as i32 + MML_OCTAVE_OFFSET;
                    if !(0..=8).contains(&octave) {
                        return Err(ParseError::InvalidOctave);
                    }
                    self.octave = octave;
                }
                b'>' => {
                    self.index += 1;
                    self.octave += 1;
                }
                b'<' => {
                    self.index += 1;
                    self.octave -= 1;
                }
                b'Q' => {
                    self.index += 1;
                    let mut quantize = self.read_tick_parameter('Q')?;
                    if quantize == 0 {
                        quantize = DEFAULT_QUANTIZE_DENOMINATOR;
                    }
                    if quantize > DEFAULT_QUANTIZE_DENOMINATOR {
                        return Err(ParseError::InvalidQuantize);
                    }
                    self.quantize_numerator = quantize;
                    self.quantize_denominator = DEFAULT_QUANTIZE_DENOMINATOR;
                    self.early_release_ticks = 0;
                }
                b'q' => {
                    self.index += 1;
                    let early_release = self.read_tick_parameter('q')?;
                    self.quantize_numerator = DEFAULT_QUANTIZE_DENOMINATOR;
                    self.quantize_denominator = DEFAULT_QUANTIZE_DENOMINATOR;
                    self.early_release_ticks = early_release;
                }
                b'c' | b'd' | b'e' | b'f' | b'g' | b'a' | b'b' => {
                    let note = self.read_note_number(byte);
                    self.index += 1;
                    let duration = self.read_duration()?;
                    let (on_ticks, off_ticks) = self.articulate_duration(duration);
                    self.push_event(EVENT_NOTE_ON, note, on_ticks)?;
                    self.push_event(EVENT_NOTE_OFF, note, off_ticks)?;
                }
                b'r' => {
                    self.index += 1;
                    let duration = self.read_duration()?;
                    self.push_event(EVENT_NOTE_OFF, 0, duration)?;
                }
                b'^' => {
                    self.index += 1;
                    let duration = self.read_duration()?;
                    self.extend_previous_timed_event(duration)?;
                }
                b'&' => {
                    self.index += 1;
                    self.slur_previous_note()?;
                }
                other => {
                    return Err(ParseError::UnexpectedCharacter(other as char));
                }
            }
        }

        Ok(())
    }

    fn push_event(&mut self, kind: u32, value: u32, length_ticks: u32) -> Result<(), ParseError> {
        if self.events.len() >= self.max_events {
            return Err(ParseError::TooManyEvents);
        }

        self.events.push(SequenceEvent {
            kind,
            value,
            length_ticks,
        });
        Ok(())
    }

    fn read_note_number(&self, byte: u8) -> u32 {
        let base = match byte {
            b'c' => 0,
            b'd' => 2,
            b'e' => 4,
            b'f' => 5,
            b'g' => 7,
            b'a' => 9,
            b'b' => 11,
            _ => 0,
        };

        (self.octave * 12 + base) as u32
    }

    fn read_duration(&mut self) -> Result<u32, ParseError> {
        let mut duration = match self.peek() {
            Some(b':') => {
                self.index += 1;
                let ticks = self.read_unsigned_number().ok_or(ParseError::InvalidLength)?;
                if ticks == 0 {
                    return Err(ParseError::InvalidLength);
                }
                ticks
            }
            Some(byte) if byte.is_ascii_digit() => {
                let divider = self.read_unsigned_number().ok_or(ParseError::InvalidLength)?;
                if divider == 0 {
                    return Err(ParseError::InvalidLength);
                }
                self.ticks_per_whole / divider
            }
            _ => self.default_length,
        };

        if duration == 0 {
            return Err(ParseError::InvalidLength);
        }

        let mut dot = duration / 2;
        while matches!(self.peek(), Some(b'.')) {
            self.index += 1;
            duration += dot;
            dot /= 2;
        }

        Ok(duration)
    }

    fn articulate_duration(&self, total_ticks: u32) -> (u32, u32) {
        let on_ticks = if self.early_release_ticks > 0 {
            if self.early_release_ticks >= total_ticks {
                total_ticks.saturating_sub(1).max(1)
            } else {
                total_ticks - self.early_release_ticks
            }
        } else {
            (total_ticks * self.quantize_numerator) / self.quantize_denominator
        }
        .max(1)
        .min(total_ticks);

        let off_ticks = total_ticks.saturating_sub(on_ticks);
        (on_ticks, off_ticks)
    }

    fn extend_previous_timed_event(&mut self, duration: u32) -> Result<(), ParseError> {
        if self.events.len() >= 2 {
            let last_index = self.events.len() - 1;
            let previous_index = self.events.len() - 2;

            let previous = self.events[previous_index];
            let last = self.events[last_index];

            if previous.kind == EVENT_NOTE_ON
                && last.kind == EVENT_NOTE_OFF
                && previous.value == last.value
                && previous.value != 0
            {
                let total_ticks = previous.length_ticks + last.length_ticks + duration;
                let (on_ticks, off_ticks) = self.articulate_duration(total_ticks);
                self.events[previous_index].length_ticks = on_ticks;
                self.events[last_index].length_ticks = off_ticks;
                return Ok(());
            }
        }

        if let Some(last) = self.events.last_mut()
            && last.kind == EVENT_NOTE_OFF
            && last.value == 0
        {
            last.length_ticks += duration;
            return Ok(());
        }

        Err(ParseError::InvalidTie)
    }

    fn slur_previous_note(&mut self) -> Result<(), ParseError> {
        if self.events.len() < 2 {
            return Err(ParseError::InvalidSlur);
        }

        let last_index = self.events.len() - 1;
        let previous_index = self.events.len() - 2;

        let previous = self.events[previous_index];
        let last = self.events[last_index];

        if previous.kind == EVENT_NOTE_ON
            && last.kind == EVENT_NOTE_OFF
            && previous.value == last.value
            && previous.value != 0
        {
            self.events[previous_index].length_ticks += last.length_ticks;
            self.events[last_index].length_ticks = 0;
            return Ok(());
        }

        Err(ParseError::InvalidSlur)
    }

    fn read_required_number(&mut self, command: char) -> Result<u32, ParseError> {
        self.read_unsigned_number()
            .ok_or(ParseError::MissingParameter(command))
    }

    fn read_tick_parameter(&mut self, command: char) -> Result<u32, ParseError> {
        if matches!(self.peek(), Some(b':')) {
            self.index += 1;
        }

        self.read_required_number(command)
    }

    fn read_unsigned_number(&mut self) -> Option<u32> {
        let start = self.index;
        let mut value = 0_u32;

        while let Some(byte) = self.peek() {
            if !byte.is_ascii_digit() {
                break;
            }
            value = value
                .saturating_mul(10)
                .saturating_add((byte - b'0') as u32);
            self.index += 1;
        }

        if self.index == start {
            None
        } else {
            Some(value)
        }
    }

    fn skip_comment(&mut self) {
        while let Some(byte) = self.peek() {
            self.index += 1;
            if byte == b'\n' {
                break;
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.chars.get(self.index).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_scale() {
        let parsed = parse_mml("o4 l4 cdefgab>c", 64).expect("parse ok");

        assert_eq!(parsed.events[0], SequenceEvent { kind: EVENT_NOTE_ON, value: 36, length_ticks: 24 });
        assert_eq!(parsed.events[2], SequenceEvent { kind: EVENT_NOTE_ON, value: 38, length_ticks: 24 });
        assert_eq!(parsed.events[14], SequenceEvent { kind: EVENT_NOTE_ON, value: 48, length_ticks: 24 });
    }

    #[test]
    fn parses_tempo_and_rest() {
        let parsed = parse_mml("t150 o4 l8 c r d", 64).expect("parse ok");

        assert_eq!(parsed.events[0], SequenceEvent { kind: EVENT_TEMPO, value: 150, length_ticks: 0 });
        assert_eq!(parsed.events[1], SequenceEvent { kind: EVENT_NOTE_ON, value: 36, length_ticks: 12 });
        assert_eq!(parsed.events[3], SequenceEvent { kind: EVENT_NOTE_OFF, value: 0, length_ticks: 12 });
        assert_eq!(parsed.events[4], SequenceEvent { kind: EVENT_NOTE_ON, value: 38, length_ticks: 12 });
        assert_eq!(parsed.events[5], SequenceEvent { kind: EVENT_NOTE_OFF, value: 38, length_ticks: 0 });
    }

    #[test]
    fn parses_dotted_lengths() {
        let parsed = parse_mml("o4 l16 c d8 e. f8.", 64).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 6);
        assert_eq!(parsed.events[2].length_ticks, 12);
        assert_eq!(parsed.events[4].length_ticks, 9);
        assert_eq!(parsed.events[6].length_ticks, 18);
    }

    #[test]
    fn parses_quantize_articulation() {
        let parsed = parse_mml("o4 l8 Q6 c", 16).expect("parse ok");

        assert_eq!(
            parsed.events[0],
            SequenceEvent {
                kind: EVENT_NOTE_ON,
                value: 36,
                length_ticks: 9
            }
        );
        assert_eq!(
            parsed.events[1],
            SequenceEvent {
                kind: EVENT_NOTE_OFF,
                value: 36,
                length_ticks: 3
            }
        );
    }

    #[test]
    fn parses_early_release_in_ticks() {
        let parsed = parse_mml("o4 l8 q3 c q:1 d", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 9);
        assert_eq!(parsed.events[1].length_ticks, 3);
        assert_eq!(parsed.events[2].length_ticks, 11);
        assert_eq!(parsed.events[3].length_ticks, 1);
    }

    #[test]
    fn parses_measure_length_change() {
        let parsed = parse_mml("C128 o4 l4 c C:96 d4", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 32);
        assert_eq!(parsed.events[2].length_ticks, 24);
    }

    #[test]
    fn parses_direct_tick_lengths() {
        let parsed = parse_mml("o4 l8 c:7 r:5", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 7);
        assert_eq!(parsed.events[1].length_ticks, 0);
        assert_eq!(parsed.events[2].length_ticks, 5);
    }

    #[test]
    fn parses_tie_with_default_articulation() {
        let parsed = parse_mml("o4 l8 c^8", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 24);
        assert_eq!(parsed.events[1].length_ticks, 0);
    }

    #[test]
    fn parses_tie_with_early_release() {
        let parsed = parse_mml("o4 l8 q3 c^8", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 21);
        assert_eq!(parsed.events[1].length_ticks, 3);
    }

    #[test]
    fn parses_slur_as_legato() {
        let parsed = parse_mml("o4 l8 q3 c&d", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 12);
        assert_eq!(parsed.events[1].length_ticks, 0);
        assert_eq!(parsed.events[2].length_ticks, 9);
        assert_eq!(parsed.events[3].length_ticks, 3);
    }

    #[test]
    fn rejects_illegal_lengths() {
        assert_eq!(parse_mml("l0 c", 16), Err(ParseError::InvalidLength));
        assert_eq!(parse_mml("c:0", 16), Err(ParseError::InvalidLength));
        assert_eq!(parse_mml("Q9 c", 16), Err(ParseError::InvalidQuantize));
        assert_eq!(parse_mml("^8", 16), Err(ParseError::InvalidTie));
        assert_eq!(parse_mml("&c", 16), Err(ParseError::InvalidSlur));
    }
}
