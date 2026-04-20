use core::fmt;

const DEFAULT_TICKS_PER_BEAT: u32 = 24;
const DEFAULT_TICKS_PER_WHOLE: u32 = DEFAULT_TICKS_PER_BEAT * 4;
const DEFAULT_NOTE_LENGTH: u32 = DEFAULT_TICKS_PER_WHOLE / 4;
const DEFAULT_TEMPO_BPM: u32 = 120;
const MML_OCTAVE_OFFSET: i32 = 0;
const DEFAULT_QUANTIZE_NUMERATOR: u32 = 8;
const DEFAULT_QUANTIZE_DENOMINATOR: u32 = 8;
const PSG_CHANNEL_COUNT: usize = 4;
const PSG_NOISE_CHANNEL: u32 = 3;
const PRESET_ENVELOPE_ID_BASE: u32 = 0x8000;

pub const EVENT_NOTE_ON: u32 = 1;
pub const EVENT_NOTE_OFF: u32 = 2;
pub const EVENT_TEMPO: u32 = 3;
pub const EVENT_VOLUME: u32 = 4;
pub const EVENT_NOISE_ON: u32 = 5;
pub const EVENT_NOISE_OFF: u32 = 6;
pub const EVENT_ENVELOPE_SELECT: u32 = 7;
pub const EVENT_PAN: u32 = 8;
pub const EVENT_PITCH_ENVELOPE_SELECT: u32 = 9;
pub const EVENT_AY_HARDWARE_ENVELOPE_SHAPE: u32 = 10;
pub const EVENT_AY_HARDWARE_ENVELOPE_PERIOD: u32 = 11;
pub const EVENT_AY_HARDWARE_ENVELOPE_ENABLE: u32 = 12;
pub const EVENT_AY_MIXER_TONE_MASK: u32 = 13;
pub const EVENT_AY_MIXER_NOISE_MASK: u32 = 14;
pub const PSG_DEFAULT_CHANNEL: u32 = 0;
pub const PSG_DEFAULT_VOLUME: u32 = 12;
pub const PSG_DEFAULT_PAN: u32 = 3;
#[allow(dead_code)]
pub const PSG_NOISE_MODE_PERIODIC: u32 = 0;
pub const PSG_NOISE_MODE_WHITE: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SequenceEvent {
    pub kind: u32,
    pub value: u32,
    pub length_ticks: u32,
    pub channel: u32,
    pub param: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSequence {
    pub ticks_per_beat: u32,
    pub loop_count: i32,
    pub events: Vec<SequenceEvent>,
    pub envelopes: Vec<EnvelopeDefinition>,
    pub pitch_envelopes: Vec<PitchEnvelopeDefinition>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeDefinition {
    pub id: u32,
    pub speed: u32,
    pub values: Vec<u32>,
    pub loop_start: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PitchEnvelopeDefinition {
    pub id: u32,
    pub initial_offset: i32,
    pub speed: u32,
    pub step: i32,
    pub delay: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedCharacter(char),
    MissingParameter(char),
    InvalidLength,
    InvalidTempo,
    InvalidOctave,
    InvalidQuantize,
    InvalidNoiseMode,
    InvalidPan,
    InvalidEnvelopeDefinition,
    InvalidEnvelopeSelection,
    InvalidPitchEnvelopeDefinition,
    InvalidPitchEnvelopeSelection,
    InvalidAyHardwareEnvelopeShape,
    InvalidAyHardwareEnvelopePeriod,
    InvalidAyHardwareEnvelopeEnable,
    InvalidAyMixerToneMask,
    InvalidAyMixerNoiseMask,
    InvalidLoopCount,
    InvalidTie,
    InvalidSlur,
    InvalidReverseRest,
    UnterminatedLoop,
    UnterminatedConditional,
    TooManyEvents,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedCharacter('\0') => write!(f, "unexpected end of input"),
            Self::UnexpectedCharacter(character) => {
                write!(f, "unexpected character '{character}'")
            }
            Self::MissingParameter(command) => {
                write!(f, "missing parameter for '{command}'")
            }
            Self::InvalidLength => write!(f, "invalid length"),
            Self::InvalidTempo => write!(f, "invalid tempo"),
            Self::InvalidOctave => write!(f, "invalid octave"),
            Self::InvalidQuantize => write!(f, "invalid quantize"),
            Self::InvalidNoiseMode => write!(f, "invalid noise mode"),
            Self::InvalidPan => write!(f, "invalid pan"),
            Self::InvalidEnvelopeDefinition => write!(f, "invalid envelope definition"),
            Self::InvalidEnvelopeSelection => write!(f, "invalid envelope selection"),
            Self::InvalidPitchEnvelopeDefinition => write!(f, "invalid pitch envelope definition"),
            Self::InvalidPitchEnvelopeSelection => write!(f, "invalid pitch envelope selection"),
            Self::InvalidAyHardwareEnvelopeShape => {
                write!(f, "invalid AY hardware envelope shape")
            }
            Self::InvalidAyHardwareEnvelopePeriod => {
                write!(f, "invalid AY hardware envelope period")
            }
            Self::InvalidAyHardwareEnvelopeEnable => {
                write!(f, "invalid AY hardware envelope enable")
            }
            Self::InvalidAyMixerToneMask => write!(f, "invalid AY mixer tone mask"),
            Self::InvalidAyMixerNoiseMask => write!(f, "invalid AY mixer noise mask"),
            Self::InvalidLoopCount => write!(f, "invalid loop count"),
            Self::InvalidTie => write!(f, "invalid '^' target"),
            Self::InvalidSlur => write!(f, "invalid '&' target"),
            Self::InvalidReverseRest => write!(f, "invalid reverse-rest target"),
            Self::UnterminatedLoop => write!(f, "unterminated loop"),
            Self::UnterminatedConditional => write!(f, "unterminated conditional"),
            Self::TooManyEvents => write!(f, "too many generated events"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseFailure {
    pub error: ParseError,
    pub position: usize,
    pub related_position: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickFixSuggestion {
    pub label: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrackState {
    ticks_per_whole: u32,
    default_length: u32,
    octave: i32,
    quantize_numerator: u32,
    quantize_denominator: u32,
    early_release_ticks: u32,
    volume: u32,
    pan: u32,
    noise_mode: u32,
    envelope_id: u32,
    pitch_envelope_id: u32,
    ay_hardware_envelope_shape: u32,
    ay_hardware_envelope_period: u32,
    ay_hardware_envelope_enabled: bool,
    ay_mixer_tone_mask: u32,
    ay_mixer_noise_mask: u32,
}

impl Default for TrackState {
    fn default() -> Self {
        Self {
            ticks_per_whole: DEFAULT_TICKS_PER_WHOLE,
            default_length: DEFAULT_NOTE_LENGTH,
            octave: 4 + MML_OCTAVE_OFFSET,
            quantize_numerator: DEFAULT_QUANTIZE_NUMERATOR,
            quantize_denominator: DEFAULT_QUANTIZE_DENOMINATOR,
            early_release_ticks: 0,
            volume: PSG_DEFAULT_VOLUME,
            pan: PSG_DEFAULT_PAN,
            noise_mode: PSG_NOISE_MODE_WHITE,
            envelope_id: 0,
            pitch_envelope_id: 0,
            ay_hardware_envelope_shape: 9,
            ay_hardware_envelope_period: 512,
            ay_hardware_envelope_enabled: false,
            ay_mixer_tone_mask: 0b111,
            ay_mixer_noise_mask: 0b111,
        }
    }
}

impl ParseFailure {
    fn at(position: usize, error: ParseError) -> Self {
        Self {
            error,
            position,
            related_position: None,
        }
    }

    fn with_related_position(position: usize, error: ParseError, related_position: usize) -> Self {
        Self {
            error,
            position,
            related_position: Some(related_position),
        }
    }

    pub fn end_position(&self, source_len: usize) -> usize {
        match self.error {
            ParseError::UnexpectedCharacter('\0') => self.position.min(source_len),
            _ => (self.position + 1).min(source_len),
        }
    }

    pub fn span_end(&self, source: &str) -> usize {
        if matches!(self.error, ParseError::UnexpectedCharacter(character) if character.is_ascii_alphabetic())
        {
            scan_command_like_end(source, self.position)
        } else {
            self.end_position(source.len())
        }
    }
}

pub fn format_parse_failure_with_context(
    source: &str,
    failure: &ParseFailure,
    conditional_branch_index: usize,
) -> String {
    let mut details = Vec::new();

    if let Some(candidate) = unsupported_command_hint(&failure.error) {
        details.push(candidate);
    }

    if let Some(expected) = expected_parameter_hint(&failure.error) {
        details.push(expected);
    }

    if let Some(structure) = structural_hint(&failure.error) {
        details.push(structure);
    }

    if let Some(related_hint) = related_position_hint(failure) {
        details.push(related_hint);
    }

    if let Some(context) = nesting_context_hint(source, failure.position, conditional_branch_index)
    {
        details.push(context);
    }

    if details.is_empty() {
        failure.error.to_string()
    } else {
        format!("{}; {}", failure.error, details.join("; "))
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn parse_mml(source: &str, max_events: usize) -> Result<ParsedSequence, ParseFailure> {
    parse_mml_with_context(source, max_events, 0)
}

pub fn parse_mml_with_context(
    source: &str,
    max_events: usize,
    conditional_branch_index: usize,
) -> Result<ParsedSequence, ParseFailure> {
    let mut parser = Parser::new(max_events, conditional_branch_index);
    parser.parse_bytes(source.as_bytes(), 0)?;
    Ok(ParsedSequence {
        ticks_per_beat: parser.ticks_per_beat,
        loop_count: parser.loop_count,
        events: parser.events,
        envelopes: parser.envelope_definitions,
        pitch_envelopes: parser.pitch_envelope_definitions,
    })
}

pub fn collect_parse_diagnostics_with_context(
    source: &str,
    max_events: usize,
    conditional_branch_index: usize,
) -> Vec<ParseFailure> {
    let mut diagnostics = scan_structural_diagnostics(source);

    if let Err(error) = parse_mml_with_context(source, max_events, conditional_branch_index) {
        let error = attach_context_related_position(source, error);
        if !diagnostics.iter().any(|entry| {
            entry.position == error.position
                && entry.error == error.error
                && entry.related_position == error.related_position
        }) {
            diagnostics.push(error);
        }
    }

    diagnostics.sort_by_key(|entry| entry.position);
    diagnostics
}

fn unsupported_command_hint(error: &ParseError) -> Option<String> {
    let ParseError::UnexpectedCharacter(character) = error else {
        return None;
    };

    if !character.is_ascii_alphabetic() || *character == '\0' {
        return None;
    }

    if "cdefgabrtlovwCQqRSL".contains(*character) {
        return None;
    }

    let suggestion = match character {
        'v' => {
            "reference spec defines v<num> as coarse volume; Stage 1 alternative is to keep pitch/rhythm only until VOL is implemented"
        }
        'V' => {
            "reference spec defines V<num> or V+<num>/V-<num> as fine volume; Stage 1 alternative is to omit it and keep the phrase structure"
        }
        'p' => {
            "reference spec defines p<num> as pan; Stage 1 has no stereo control yet, so remove p<num> and verify the melody first"
        }
        'k' => {
            "reference spec notes k<num> is currently handled like _<num>; Stage 1 alternative is to rewrite it as _<num> once transpose is added"
        }
        'K' => {
            "reference spec defines K<num> as detune; Stage 1 has no detune yet, so keep the note sequence and drop K<num> for now"
        }
        'E' => {
            "reference spec defines E<num> as volume envelope; Stage 1 alternative is to use q or Q for rough articulation only"
        }
        'M' => {
            "reference spec defines M<num> as pitch envelope; Stage 1 alternative is to spell the pitch motion as explicit notes"
        }
        'P' => {
            "reference spec defines P<num> as pan envelope; Stage 1 has no pan lane yet, so omit it for now"
        }
        'G' => {
            "reference spec defines G<num> as portamento; Stage 1 alternative is to approximate it with short connecting notes or ~"
        }
        'D' => {
            "reference spec defines D<num> as drum mode; Stage 1 has no drum-note remap yet, so keep explicit note names only"
        }
        'T' => {
            "reference spec defines T<num> as platform tempo; Stage 1 alternative is to use t<num> BPM tempo"
        }
        'L' => {
            "reference spec defines L as segno; Stage 1 alternative is to expand the repeated section with [] where possible"
        }
        'n' => {
            "direct note-number style is not implemented in this parser; Stage 1 alternative is to rewrite it with o<num> and cdefgab"
        }
        's' => {
            "reference state rules define s<ticks> as shuffle; Stage 1 alternative is to rewrite timing with explicit :ticks lengths"
        }
        'x' => {
            "this looks like a custom or extended command; compare it against _reference/mml_spec/commands.md and keep to Stage 1 core commands first"
        }
        _ => {
            "compare this command against _reference/mml_spec/commands.md; supported Stage 1 core commands are t l o C Q q R and notes cdefgab/r"
        }
    };
    let example = unsupported_command_example_hint(*character);

    Some(match example {
        Some(example) => format!(
            "possibly unsupported command '{}'; {}; try rewriting it like: {}",
            character, suggestion, example
        ),
        None => format!(
            "possibly unsupported command '{}'; {}",
            character, suggestion
        ),
    })
}

fn unsupported_command_example_hint(character: char) -> Option<&'static str> {
    match character {
        'v' | 'V' => Some("o4 l8 c d e f"),
        'p' | 'P' => Some("o4 l8 c d e g"),
        'k' | 'K' => Some("o4 cdefgab>c"),
        'E' => Some("q3 o4 l8 c d e f"),
        'M' => Some("o4 l16 c d e f g"),
        'G' => Some("o4 l16 c~d:3 e"),
        'D' => Some("o4 l8 c r c r"),
        'T' => Some("t120 o4 l8 cdef"),
        'L' => Some("[cdef]2 g"),
        'n' => Some("o4 l8 c d e f"),
        's' => Some("l8 c:10 d:14 e:10 f:14"),
        _ => None,
    }
}

pub fn parse_failure_quick_fixes(source: &str, failure: &ParseFailure) -> Vec<QuickFixSuggestion> {
    match failure.error {
        ParseError::UnexpectedCharacter(character) if character.is_ascii_alphabetic() => {
            unsupported_command_quick_fixes(character)
        }
        ParseError::MissingParameter(command) => missing_parameter_quick_fixes(command),
        _ => {
            let _ = source;
            Vec::new()
        }
    }
}

fn unsupported_command_quick_fixes(character: char) -> Vec<QuickFixSuggestion> {
    let mut suggestions = Vec::new();

    if let Some(example) = unsupported_command_example_hint(character) {
        suggestions.push(QuickFixSuggestion {
            label: "仕様に近い最小例".to_string(),
            replacement: example.to_string(),
        });
    }

    let alternative = match character {
        'v' | 'V' => Some(("音量指定を外して確認", "o4 l8 c e g > c")),
        'p' | 'P' => Some(("パン指定を外して確認", "o4 l8 c d e g")),
        'k' | 'K' => Some(("移調なしの音列へ寄せる", "o4 cdefgab>c")),
        'E' => Some(("q で発音長だけ近づける", "q3 o4 l8 c d e f")),
        'M' => Some(("音高変化を明示音符へ展開", "o4 l16 c d e f g")),
        'G' => Some(("短い経過音で近似する", "o4 l16 c d e")),
        'D' => Some(("通常ノート列へ置き換える", "o4 l8 c r c r")),
        'T' => Some(("小文字 t の BPM へ寄せる", "t120 o4 l8 cdef")),
        'L' => Some(("セクションを展開型ループへ寄せる", "[cdef]2 g")),
        'n' => Some(("音名ベースへ書き換える", "o4 l8 c d e f")),
        's' => Some(("tick 長を直接書く", "l8 c:10 d:14 e:10 f:14")),
        _ => None,
    };

    if let Some((label, replacement)) = alternative {
        let replacement = replacement.to_string();
        if !suggestions
            .iter()
            .any(|entry| entry.replacement == replacement)
        {
            suggestions.push(QuickFixSuggestion {
                label: label.to_string(),
                replacement,
            });
        }
    }

    if suggestions.is_empty() {
        suggestions.push(QuickFixSuggestion {
            label: "最小の音列へ置換".to_string(),
            replacement: "o4 l8 c d e f".to_string(),
        });
    }

    suggestions
}

fn missing_parameter_quick_fixes(command: char) -> Vec<QuickFixSuggestion> {
    match command {
        't' => vec![
            QuickFixSuggestion {
                label: "標準テンポ".to_string(),
                replacement: "t120".to_string(),
            },
            QuickFixSuggestion {
                label: "やや速め".to_string(),
                replacement: "t150".to_string(),
            },
        ],
        'o' => vec![
            QuickFixSuggestion {
                label: "標準オクターブ".to_string(),
                replacement: "o4".to_string(),
            },
            QuickFixSuggestion {
                label: "1オクターブ上".to_string(),
                replacement: "o5".to_string(),
            },
        ],
        'l' => vec![
            QuickFixSuggestion {
                label: "8分音符基準".to_string(),
                replacement: "l8".to_string(),
            },
            QuickFixSuggestion {
                label: "tick 直指定".to_string(),
                replacement: "l:12".to_string(),
            },
        ],
        'C' => vec![
            QuickFixSuggestion {
                label: "標準 ticks-per-whole".to_string(),
                replacement: "C96".to_string(),
            },
            QuickFixSuggestion {
                label: "tick 形式".to_string(),
                replacement: "C:96".to_string(),
            },
        ],
        'Q' => vec![
            QuickFixSuggestion {
                label: "後ろ詰め弱め".to_string(),
                replacement: "Q6".to_string(),
            },
            QuickFixSuggestion {
                label: "tick 形式".to_string(),
                replacement: "Q:6".to_string(),
            },
        ],
        'q' => vec![
            QuickFixSuggestion {
                label: "ゲート 3/8".to_string(),
                replacement: "q3".to_string(),
            },
            QuickFixSuggestion {
                label: "tick 形式".to_string(),
                replacement: "q:3".to_string(),
            },
        ],
        _ => Vec::new(),
    }
}

fn scan_command_like_end(source: &str, start: usize) -> usize {
    let bytes = source.as_bytes();
    let mut index = start;

    while let Some(byte) = peek(bytes, index) {
        if byte.is_ascii_alphanumeric()
            || matches!(byte, b'+' | b'-' | b':' | b'=' | b',' | b'{' | b'}' | b'_')
        {
            index += 1;
            continue;
        }

        break;
    }

    index.max(start + 1).min(source.len())
}

fn expected_parameter_hint(error: &ParseError) -> Option<String> {
    let ParseError::MissingParameter(command) = error else {
        return None;
    };

    Some(match command {
        't' => "tempo command expects a number such as t120".to_string(),
        'o' => "octave command expects a number such as o4".to_string(),
        'l' => "default length expects a divider such as l8 or tick form like l:12".to_string(),
        'C' => "ticks-per-whole expects a number such as C96 or C:96".to_string(),
        'Q' | 'q' => format!(
            "'{}' expects a numeric value such as {}6 or {}:3",
            command, command, command
        ),
        _ => format!("'{}' expects a numeric parameter", command),
    })
}

fn structural_hint(error: &ParseError) -> Option<String> {
    Some(match error {
        ParseError::UnterminatedLoop => {
            "loop started here and must be closed with ']' before any repeat count".to_string()
        }
        ParseError::UnterminatedConditional => {
            "conditional started here; split branches with '/' and close with '}'".to_string()
        }
        ParseError::UnexpectedCharacter(']') => {
            "found loop close without a matching '['".to_string()
        }
        ParseError::UnexpectedCharacter('}') => {
            "found conditional close without a matching '{'".to_string()
        }
        _ => return None,
    })
}

fn related_position_hint(failure: &ParseFailure) -> Option<String> {
    failure
        .related_position
        .map(|position| format!("matching opener is near offset {}", position))
}

fn nesting_context_hint(
    source: &str,
    position: usize,
    conditional_branch_index: usize,
) -> Option<String> {
    let context = scan_nesting_context(source, position);
    let mut parts = Vec::new();

    if context.loop_depth > 0 {
        parts.push(format!("inside loop depth {}", context.loop_depth));
    }

    if context.conditional_depth > 0 {
        parts.push(format!(
            "inside conditional depth {} with selected branch {}",
            context.conditional_depth, conditional_branch_index
        ));
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct NestingContext {
    loop_depth: u32,
    conditional_depth: u32,
    innermost_opener: Option<usize>,
}

fn scan_nesting_context(source: &str, position: usize) -> NestingContext {
    let bytes = source.as_bytes();
    let mut loop_stack: Vec<usize> = Vec::new();
    let mut conditional_stack: Vec<usize> = Vec::new();
    let mut index = 0;

    while index < position.min(bytes.len()) {
        match bytes[index] {
            b';' => {
                skip_comment(bytes, &mut index);
                continue;
            }
            b'[' => loop_stack.push(index),
            b']' => {
                loop_stack.pop();
            }
            b'{' => conditional_stack.push(index),
            b'}' => {
                conditional_stack.pop();
            }
            _ => {}
        }
        index += 1;
    }

    let innermost_opener = match (loop_stack.last(), conditional_stack.last()) {
        (Some(loop_position), Some(conditional_position)) => {
            Some((*loop_position).max(*conditional_position))
        }
        (Some(loop_position), None) => Some(*loop_position),
        (None, Some(conditional_position)) => Some(*conditional_position),
        (None, None) => None,
    };

    NestingContext {
        loop_depth: loop_stack.len() as u32,
        conditional_depth: conditional_stack.len() as u32,
        innermost_opener,
    }
}

fn attach_context_related_position(source: &str, mut failure: ParseFailure) -> ParseFailure {
    if failure.related_position.is_some() {
        return failure;
    }

    failure.related_position = scan_nesting_context(source, failure.position).innermost_opener;
    failure
}

struct Parser {
    max_events: usize,
    ticks_per_beat: u32,
    loop_count: i32,
    tempo_bpm: u32,
    conditional_branch_index: usize,
    active_channels: Vec<u32>,
    track_states: [TrackState; PSG_CHANNEL_COUNT],
    envelope_definitions: Vec<EnvelopeDefinition>,
    pitch_envelope_definitions: Vec<PitchEnvelopeDefinition>,
    events: Vec<SequenceEvent>,
}

impl Parser {
    fn new(max_events: usize, conditional_branch_index: usize) -> Self {
        Self {
            max_events,
            ticks_per_beat: DEFAULT_TICKS_PER_BEAT,
            loop_count: 0,
            tempo_bpm: DEFAULT_TEMPO_BPM,
            conditional_branch_index,
            active_channels: vec![PSG_DEFAULT_CHANNEL],
            track_states: [TrackState::default(); PSG_CHANNEL_COUNT],
            envelope_definitions: Vec::new(),
            pitch_envelope_definitions: Vec::new(),
            events: Vec::new(),
        }
    }

    fn parse_bytes(&mut self, bytes: &[u8], base_offset: usize) -> Result<(), ParseFailure> {
        let mut index = 0;
        let mut at_line_start = true;

        while let Some(byte) = peek(bytes, index) {
            let position = base_offset + index;

            if at_line_start {
                if matches!(byte, b' ' | b'\t' | b'\r') {
                    index += 1;
                    continue;
                }

                if let Some((channels, next_index)) = parse_track_selector(bytes, index) {
                    self.active_channels = channels;
                    index = next_index;
                    at_line_start = false;
                    continue;
                }
            }

            at_line_start = false;

            match byte {
                b' ' | b'\t' | b'\r' | b'|' => {
                    index += 1;
                }
                b'\n' => {
                    index += 1;
                    at_line_start = true;
                }
                b';' => {
                    skip_comment(bytes, &mut index);
                    at_line_start = true;
                }
                b'@' => {
                    index += 1;
                    self.parse_at_command(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                }
                b'E' => {
                    index += 1;
                    self.parse_ay_hardware_envelope_command(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                }
                b'M' => {
                    index += 1;
                    self.parse_ay_mixer_command(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                }
                b't' => {
                    index += 1;
                    let tempo = read_required_number(bytes, &mut index, 't')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if tempo == 0 {
                        return Err(ParseFailure::at(position, ParseError::InvalidTempo));
                    }
                    self.tempo_bpm = tempo;
                    self.push_event_with_meta(EVENT_TEMPO, tempo, 0, PSG_DEFAULT_CHANNEL, 0)?;
                }
                b'l' => {
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.for_each_active_track_state_mut(|state| {
                        state.default_length = duration;
                    });
                }
                b'C' => {
                    index += 1;
                    let ticks = self
                        .read_tick_parameter(bytes, &mut index, 'C')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if ticks == 0 {
                        return Err(ParseFailure::at(position, ParseError::InvalidLength));
                    }
                    self.for_each_active_track_state_mut(|state| {
                        state.ticks_per_whole = ticks;
                    });
                }
                b'L' => {
                    index += 1;
                    let loop_count = read_required_signed_number(bytes, &mut index, 'L')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if loop_count < -1 {
                        return Err(ParseFailure::at(position, ParseError::InvalidLoopCount));
                    }
                    self.loop_count = loop_count;
                }
                b'o' => {
                    index += 1;
                    let octave = read_required_number(bytes, &mut index, 'o')
                        .map_err(|error| ParseFailure::at(position, error))?
                        as i32
                        + MML_OCTAVE_OFFSET;
                    if !(0..=8).contains(&octave) {
                        return Err(ParseFailure::at(position, ParseError::InvalidOctave));
                    }
                    self.for_each_active_track_state_mut(|state| {
                        state.octave = octave;
                    });
                }
                b'>' => {
                    index += 1;
                    self.for_each_active_track_state_mut(|state| {
                        state.octave += 1;
                    });
                }
                b'<' => {
                    index += 1;
                    self.for_each_active_track_state_mut(|state| {
                        state.octave -= 1;
                    });
                }
                b'v' => {
                    index += 1;
                    let volume = read_required_number(bytes, &mut index, 'v')
                        .map_err(|error| ParseFailure::at(position, error))?
                        .min(15);
                    for channel in self.active_channels.clone() {
                        self.track_state_mut(channel).volume = volume;
                        let param = if channel == PSG_NOISE_CHANNEL {
                            self.track_state(channel).noise_mode
                        } else {
                            0
                        };
                        self.push_event_with_meta(EVENT_VOLUME, volume, 0, channel, param)?;
                    }
                }
                b'p' => {
                    index += 1;
                    let pan = read_required_number(bytes, &mut index, 'p')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if pan > 3 {
                        return Err(ParseFailure::at(position, ParseError::InvalidPan));
                    }
                    for channel in self.active_channels.clone() {
                        self.track_state_mut(channel).pan = pan;
                        self.push_event_with_meta(EVENT_PAN, pan, 0, channel, 0)?;
                    }
                }
                b'w' => {
                    index += 1;
                    let noise_mode = read_required_number(bytes, &mut index, 'w')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if noise_mode > PSG_NOISE_MODE_WHITE {
                        return Err(ParseFailure::at(position, ParseError::InvalidNoiseMode));
                    }
                    for channel in self.active_channels.clone() {
                        self.track_state_mut(channel).noise_mode = noise_mode;
                        if channel == PSG_NOISE_CHANNEL {
                            self.push_event_with_meta(
                                EVENT_VOLUME,
                                self.track_state(channel).volume,
                                0,
                                channel,
                                noise_mode,
                            )?;
                        }
                    }
                }
                b'S' => {
                    index += 1;
                    let preset = read_required_number(bytes, &mut index, 'S')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.select_preset_envelope(preset)
                        .map_err(|error| ParseFailure::at(position, error))?;
                }
                b'Q' => {
                    index += 1;
                    let mut quantize = self
                        .read_tick_parameter(bytes, &mut index, 'Q')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if quantize == 0 {
                        quantize = DEFAULT_QUANTIZE_DENOMINATOR;
                    }
                    if quantize > DEFAULT_QUANTIZE_DENOMINATOR {
                        return Err(ParseFailure::at(position, ParseError::InvalidQuantize));
                    }
                    self.for_each_active_track_state_mut(|state| {
                        state.quantize_numerator = quantize;
                        state.quantize_denominator = DEFAULT_QUANTIZE_DENOMINATOR;
                        state.early_release_ticks = 0;
                    });
                }
                b'q' => {
                    index += 1;
                    let early_release = self
                        .read_tick_parameter(bytes, &mut index, 'q')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.for_each_active_track_state_mut(|state| {
                        state.quantize_numerator = DEFAULT_QUANTIZE_DENOMINATOR;
                        state.quantize_denominator = DEFAULT_QUANTIZE_DENOMINATOR;
                        state.early_release_ticks = early_release;
                    });
                }
                b'c' | b'd' | b'e' | b'f' | b'g' | b'a' | b'b' => {
                    let channels = self.active_channels.clone();
                    index += 1;
                    let accidental = read_note_accidental(bytes, &mut index);
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;

                    for channel in channels {
                        let note = self.read_note_number(byte, accidental, channel);
                        let (on_ticks, off_ticks) = self.articulate_duration(duration, channel);
                        if channel == PSG_NOISE_CHANNEL {
                            let noise_frequency = noise_frequency_from_note_number(note);
                            self.push_event_with_meta(
                                EVENT_NOISE_ON,
                                noise_frequency,
                                on_ticks,
                                channel,
                                encode_noise_param(
                                    self.track_state(channel).volume,
                                    self.track_state(channel).noise_mode,
                                ),
                            )?;
                            self.push_event_with_meta(
                                EVENT_NOISE_OFF,
                                noise_frequency,
                                off_ticks,
                                channel,
                                0,
                            )?;
                        } else {
                            self.push_event_with_meta(
                                EVENT_NOTE_ON,
                                note,
                                on_ticks,
                                channel,
                                self.track_state(channel).volume,
                            )?;
                            self.push_event_with_meta(EVENT_NOTE_OFF, note, off_ticks, channel, 0)?;
                        }
                    }
                }
                b'r' => {
                    let channels = self.active_channels.clone();
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    for channel in channels {
                        let kind = if channel == PSG_NOISE_CHANNEL {
                            EVENT_NOISE_OFF
                        } else {
                            EVENT_NOTE_OFF
                        };
                        self.push_event_with_meta(kind, 0, duration, channel, 0)?;
                    }
                }
                b'R' => {
                    let channels = self.active_channels.clone();
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    for channel in channels {
                        self.reverse_previous_timed_event(duration, position, channel)?;
                    }
                }
                b'~' => {
                    let channels = self.active_channels.clone();
                    index += 1;
                    let note_token = peek(bytes, index).ok_or(ParseFailure::at(
                        position,
                        ParseError::UnexpectedCharacter('\0'),
                    ))?;
                    let note_byte = match note_token {
                        b'c' | b'd' | b'e' | b'f' | b'g' | b'a' | b'b' => {
                            index += 1;
                            note_token
                        }
                        other => {
                            return Err(ParseFailure::at(
                                base_offset + index,
                                ParseError::UnexpectedCharacter(other as char),
                            ));
                        }
                    };
                    let accidental = read_note_accidental(bytes, &mut index);
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    for channel in channels {
                        let note = self.read_note_number(note_byte, accidental, channel);
                        self.reverse_previous_timed_event(duration, position, channel)?;
                        let (on_ticks, off_ticks) = self.articulate_duration(duration, channel);
                        if channel == PSG_NOISE_CHANNEL {
                            let noise_frequency = noise_frequency_from_note_number(note);
                            self.push_event_with_meta(
                                EVENT_NOISE_ON,
                                noise_frequency,
                                on_ticks,
                                channel,
                                encode_noise_param(
                                    self.track_state(channel).volume,
                                    self.track_state(channel).noise_mode,
                                ),
                            )?;
                            self.push_event_with_meta(
                                EVENT_NOISE_OFF,
                                noise_frequency,
                                off_ticks,
                                channel,
                                0,
                            )?;
                        } else {
                            self.push_event_with_meta(
                                EVENT_NOTE_ON,
                                note,
                                on_ticks,
                                channel,
                                self.track_state(channel).volume,
                            )?;
                            self.push_event_with_meta(EVENT_NOTE_OFF, note, off_ticks, channel, 0)?;
                        }
                    }
                }
                b'^' => {
                    let channels = self.active_channels.clone();
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    for channel in channels {
                        self.extend_previous_timed_event(duration, position, channel)?;
                    }
                }
                b'&' => {
                    let channels = self.active_channels.clone();
                    index += 1;
                    for channel in channels {
                        self.slur_previous_note(position, channel)?;
                    }
                }
                b'[' => {
                    index += 1;
                    let sections = split_loop_sections(bytes, index, base_offset)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    index = sections.next_index;

                    for iteration in 0..sections.repeat_count {
                        self.parse_bytes(sections.body, sections.body_offset)?;
                        if iteration + 1 != sections.repeat_count
                            && let Some((break_bytes, break_offset)) = sections.break_section
                        {
                            self.parse_bytes(break_bytes, break_offset)?;
                        }
                    }
                }
                b'{' => {
                    index += 1;
                    let sections = split_conditional_sections(bytes, index, base_offset)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    index = sections.next_index;
                    let selected = self
                        .conditional_branch_index
                        .min(sections.branches.len().saturating_sub(1));
                    if let Some((branch, branch_offset)) = sections.branches.get(selected) {
                        self.parse_bytes(branch, *branch_offset)?;
                    }
                }
                other => {
                    return Err(ParseFailure::at(
                        position,
                        ParseError::UnexpectedCharacter(other as char),
                    ));
                }
            }
        }

        Ok(())
    }

    fn primary_channel(&self) -> u32 {
        self.active_channels
            .first()
            .copied()
            .unwrap_or(PSG_DEFAULT_CHANNEL)
    }

    fn track_state(&self, channel: u32) -> &TrackState {
        &self.track_states[channel.min((PSG_CHANNEL_COUNT - 1) as u32) as usize]
    }

    fn track_state_mut(&mut self, channel: u32) -> &mut TrackState {
        &mut self.track_states[channel.min((PSG_CHANNEL_COUNT - 1) as u32) as usize]
    }

    fn for_each_active_track_state_mut(&mut self, mut update: impl FnMut(&mut TrackState)) {
        let channels = self.active_channels.clone();
        for channel in channels {
            update(self.track_state_mut(channel));
        }
    }

    fn parse_at_command(&mut self, bytes: &[u8], index: &mut usize) -> Result<(), ParseError> {
        match peek(bytes, *index) {
            Some(b'E') => {
                *index += 1;
                skip_spaces_inline(bytes, index);
                let envelope_id = read_required_number(bytes, index, 'E')
                    .map_err(|_| ParseError::InvalidEnvelopeSelection)?;
                skip_spaces_inline(bytes, index);

                if matches!(peek(bytes, *index), Some(b'=')) {
                    *index += 1;
                    let definition = self.parse_envelope_definition(bytes, index, envelope_id)?;
                    self.store_envelope_definition(definition);
                    return Ok(());
                }

                self.apply_envelope_selection(envelope_id)
            }
            Some(b'p') => {
                *index += 1;
                skip_spaces_inline(bytes, index);
                let envelope_id = read_required_number(bytes, index, 'p')
                    .map_err(|_| ParseError::InvalidPitchEnvelopeSelection)?;
                skip_spaces_inline(bytes, index);

                if matches!(peek(bytes, *index), Some(b'=')) {
                    *index += 1;
                    let definition =
                        self.parse_pitch_envelope_definition(bytes, index, envelope_id)?;
                    self.store_pitch_envelope_definition(definition);
                    return Ok(());
                }

                self.apply_pitch_envelope_selection(envelope_id)
            }
            Some(other) => Err(ParseError::UnexpectedCharacter(other as char)),
            None => Err(ParseError::UnexpectedCharacter('\0')),
        }
    }

    fn parse_ay_hardware_envelope_command(
        &mut self,
        bytes: &[u8],
        index: &mut usize,
    ) -> Result<(), ParseError> {
        match peek(bytes, *index) {
            Some(b'H') => {
                *index += 1;
                let shape = read_required_number(bytes, index, 'H')
                    .map_err(|_| ParseError::InvalidAyHardwareEnvelopeShape)?;
                if shape > 15 {
                    return Err(ParseError::InvalidAyHardwareEnvelopeShape);
                }
                self.for_each_active_track_state_mut(|state| {
                    state.ay_hardware_envelope_shape = shape;
                });
                self.push_event_with_meta(
                    EVENT_AY_HARDWARE_ENVELOPE_SHAPE,
                    shape,
                    0,
                    self.primary_channel(),
                    0,
                )
                .map_err(|_| ParseError::TooManyEvents)?;
                Ok(())
            }
            Some(b'P') => {
                *index += 1;
                let period = read_required_number(bytes, index, 'P')
                    .map_err(|_| ParseError::InvalidAyHardwareEnvelopePeriod)?;
                if period == 0 {
                    return Err(ParseError::InvalidAyHardwareEnvelopePeriod);
                }
                self.for_each_active_track_state_mut(|state| {
                    state.ay_hardware_envelope_period = period;
                });
                self.push_event_with_meta(
                    EVENT_AY_HARDWARE_ENVELOPE_PERIOD,
                    period,
                    0,
                    self.primary_channel(),
                    0,
                )
                .map_err(|_| ParseError::TooManyEvents)?;
                Ok(())
            }
            Some(b'E') => {
                *index += 1;
                let enabled = read_required_number(bytes, index, 'E')
                    .map_err(|_| ParseError::InvalidAyHardwareEnvelopeEnable)?;
                if enabled > 1 {
                    return Err(ParseError::InvalidAyHardwareEnvelopeEnable);
                }
                self.apply_ay_hardware_envelope_enable(enabled != 0)
            }
            Some(other) => Err(ParseError::UnexpectedCharacter(other as char)),
            None => Err(ParseError::UnexpectedCharacter('\0')),
        }
    }

    fn parse_ay_mixer_command(&mut self, bytes: &[u8], index: &mut usize) -> Result<(), ParseError> {
        match peek(bytes, *index) {
            Some(b'T') => {
                *index += 1;
                let mask = read_required_number(bytes, index, 'T')
                    .map_err(|_| ParseError::InvalidAyMixerToneMask)?;
                if mask > 0b111 {
                    return Err(ParseError::InvalidAyMixerToneMask);
                }
                self.for_each_active_track_state_mut(|state| {
                    state.ay_mixer_tone_mask = mask;
                });
                self.push_event_with_meta(
                    EVENT_AY_MIXER_TONE_MASK,
                    mask,
                    0,
                    self.primary_channel(),
                    0,
                )
                .map_err(|_| ParseError::TooManyEvents)?;
                Ok(())
            }
            Some(b'N') => {
                *index += 1;
                let mask = read_required_number(bytes, index, 'N')
                    .map_err(|_| ParseError::InvalidAyMixerNoiseMask)?;
                if mask > 0b111 {
                    return Err(ParseError::InvalidAyMixerNoiseMask);
                }
                self.for_each_active_track_state_mut(|state| {
                    state.ay_mixer_noise_mask = mask;
                });
                self.push_event_with_meta(
                    EVENT_AY_MIXER_NOISE_MASK,
                    mask,
                    0,
                    self.primary_channel(),
                    0,
                )
                .map_err(|_| ParseError::TooManyEvents)?;
                Ok(())
            }
            Some(other) => Err(ParseError::UnexpectedCharacter(other as char)),
            None => Err(ParseError::UnexpectedCharacter('\0')),
        }
    }

    fn select_preset_envelope(&mut self, preset: u32) -> Result<(), ParseError> {
        if preset == 0 {
            self.apply_envelope_selection(0)?;
            return Ok(());
        }

        let Some(definition) = preset_envelope_definition(preset) else {
            return Err(ParseError::InvalidEnvelopeSelection);
        };

        self.store_envelope_definition(definition.clone());
        self.apply_envelope_selection(definition.id)
    }

    fn apply_envelope_selection(&mut self, envelope_id: u32) -> Result<(), ParseError> {
        for channel in self.active_channels.clone() {
            self.track_state_mut(channel).envelope_id = envelope_id;
            self.track_state_mut(channel).ay_hardware_envelope_enabled = false;
            self.push_event_with_meta(EVENT_AY_HARDWARE_ENVELOPE_ENABLE, 0, 0, channel, 0)
                .map_err(|_| ParseError::TooManyEvents)?;
            self.push_event_with_meta(EVENT_ENVELOPE_SELECT, envelope_id, 0, channel, 0)
                .map_err(|_| ParseError::TooManyEvents)?;
        }
        Ok(())
    }

    fn apply_pitch_envelope_selection(&mut self, envelope_id: u32) -> Result<(), ParseError> {
        if envelope_id != 0
            && !self
                .pitch_envelope_definitions
                .iter()
                .any(|definition| definition.id == envelope_id)
        {
            return Err(ParseError::InvalidPitchEnvelopeSelection);
        }

        for channel in self.active_channels.clone() {
            self.track_state_mut(channel).pitch_envelope_id = envelope_id;
            self.push_event_with_meta(EVENT_PITCH_ENVELOPE_SELECT, envelope_id, 0, channel, 0)
                .map_err(|_| ParseError::TooManyEvents)?;
        }
        Ok(())
    }

    fn apply_ay_hardware_envelope_enable(&mut self, enabled: bool) -> Result<(), ParseError> {
        for channel in self.active_channels.clone() {
            self.track_state_mut(channel).ay_hardware_envelope_enabled = enabled;
            self.push_event_with_meta(
                EVENT_AY_HARDWARE_ENVELOPE_ENABLE,
                if enabled { 1 } else { 0 },
                0,
                channel,
                0,
            )
            .map_err(|_| ParseError::TooManyEvents)?;
        }
        Ok(())
    }

    fn parse_envelope_definition(
        &self,
        bytes: &[u8],
        index: &mut usize,
        envelope_id: u32,
    ) -> Result<EnvelopeDefinition, ParseError> {
        skip_spaces_inline(bytes, index);
        if !matches!(peek(bytes, *index), Some(b'{')) {
            return Err(ParseError::InvalidEnvelopeDefinition);
        }
        *index += 1;

        let mut items = Vec::new();
        loop {
            skip_spaces_and_commas(bytes, index);
            match peek(bytes, *index) {
                Some(b'}') => {
                    *index += 1;
                    break;
                }
                Some(byte) if byte.is_ascii_digit() => {
                    let value = read_unsigned_number(bytes, index)
                        .ok_or(ParseError::InvalidEnvelopeDefinition)?;
                    items.push(value);
                }
                Some(_) | None => return Err(ParseError::InvalidEnvelopeDefinition),
            }
        }

        if items.len() < 2 || items[0] == 0 {
            return Err(ParseError::InvalidEnvelopeDefinition);
        }

        let speed = items[0];
        let mut values = Vec::new();
        let mut loop_start = None;
        let mut cursor = 1;
        while cursor < items.len() {
            let value = items[cursor];
            if value == 255 {
                let Some(next_loop_start) = items.get(cursor + 1).copied() else {
                    return Err(ParseError::InvalidEnvelopeDefinition);
                };
                loop_start = Some(next_loop_start);
                break;
            }
            if value > 15 {
                return Err(ParseError::InvalidEnvelopeDefinition);
            }
            values.push(value);
            cursor += 1;
        }

        if values.is_empty() {
            return Err(ParseError::InvalidEnvelopeDefinition);
        }

        Ok(EnvelopeDefinition {
            id: envelope_id,
            speed,
            values,
            loop_start,
        })
    }

    fn parse_pitch_envelope_definition(
        &self,
        bytes: &[u8],
        index: &mut usize,
        envelope_id: u32,
    ) -> Result<PitchEnvelopeDefinition, ParseError> {
        skip_spaces_inline(bytes, index);
        if !matches!(peek(bytes, *index), Some(b'{')) {
            return Err(ParseError::InvalidPitchEnvelopeDefinition);
        }
        *index += 1;

        let mut items = Vec::new();
        loop {
            skip_spaces_and_commas(bytes, index);
            match peek(bytes, *index) {
                Some(b'}') => {
                    *index += 1;
                    break;
                }
                Some(_) => {
                    let value = read_signed_number(bytes, index)
                        .ok_or(ParseError::InvalidPitchEnvelopeDefinition)?;
                    items.push(value);
                }
                None => return Err(ParseError::InvalidPitchEnvelopeDefinition),
            }
        }

        if items.len() != 4 || items[1] <= 0 || items[3] < 0 {
            return Err(ParseError::InvalidPitchEnvelopeDefinition);
        }

        Ok(PitchEnvelopeDefinition {
            id: envelope_id,
            initial_offset: items[0],
            speed: items[1] as u32,
            step: items[2],
            delay: items[3] as u32,
        })
    }

    fn store_envelope_definition(&mut self, definition: EnvelopeDefinition) {
        if let Some(index) = self
            .envelope_definitions
            .iter()
            .position(|entry| entry.id == definition.id)
        {
            self.envelope_definitions[index] = definition;
        } else {
            self.envelope_definitions.push(definition);
        }
    }

    fn store_pitch_envelope_definition(&mut self, definition: PitchEnvelopeDefinition) {
        if let Some(index) = self
            .pitch_envelope_definitions
            .iter()
            .position(|entry| entry.id == definition.id)
        {
            self.pitch_envelope_definitions[index] = definition;
        } else {
            self.pitch_envelope_definitions.push(definition);
        }
    }

    #[allow(dead_code)]
    fn push_event(&mut self, kind: u32, value: u32, length_ticks: u32) -> Result<(), ParseFailure> {
        self.push_event_with_meta(kind, value, length_ticks, PSG_DEFAULT_CHANNEL, 0)
    }

    fn push_event_with_meta(
        &mut self,
        kind: u32,
        value: u32,
        length_ticks: u32,
        channel: u32,
        param: u32,
    ) -> Result<(), ParseFailure> {
        if self.events.len() >= self.max_events {
            return Err(ParseFailure::at(0, ParseError::TooManyEvents));
        }

        self.events.push(SequenceEvent {
            kind,
            value,
            length_ticks,
            channel,
            param,
        });
        Ok(())
    }

    fn read_note_number(&self, byte: u8, accidental: i32, channel: u32) -> u32 {
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

        (self.track_state(channel).octave * 12 + base + accidental).max(0) as u32
    }

    fn read_duration(&self, bytes: &[u8], index: &mut usize) -> Result<u32, ParseError> {
        let state = self.track_state(self.primary_channel());
        let mut duration = match peek(bytes, *index) {
            Some(b':') => {
                *index += 1;
                let ticks = read_unsigned_number(bytes, index).ok_or(ParseError::InvalidLength)?;
                if ticks == 0 {
                    return Err(ParseError::InvalidLength);
                }
                ticks
            }
            Some(byte) if byte.is_ascii_digit() => {
                let divider =
                    read_unsigned_number(bytes, index).ok_or(ParseError::InvalidLength)?;
                if divider == 0 {
                    return Err(ParseError::InvalidLength);
                }
                state.ticks_per_whole / divider
            }
            _ => state.default_length,
        };

        if duration == 0 {
            return Err(ParseError::InvalidLength);
        }

        let mut dot = duration / 2;
        while matches!(peek(bytes, *index), Some(b'.')) {
            *index += 1;
            duration += dot;
            dot /= 2;
        }

        Ok(duration)
    }

    fn articulate_duration(&self, total_ticks: u32, channel: u32) -> (u32, u32) {
        let state = self.track_state(channel);
        let on_ticks = if state.early_release_ticks > 0 {
            if state.early_release_ticks >= total_ticks {
                total_ticks.saturating_sub(1).max(1)
            } else {
                total_ticks - state.early_release_ticks
            }
        } else {
            (total_ticks * state.quantize_numerator) / state.quantize_denominator
        }
        .max(1)
        .min(total_ticks);

        let off_ticks = total_ticks.saturating_sub(on_ticks);
        (on_ticks, off_ticks)
    }

    fn read_tick_parameter(
        &self,
        bytes: &[u8],
        index: &mut usize,
        command: char,
    ) -> Result<u32, ParseError> {
        if matches!(peek(bytes, *index), Some(b':')) {
            *index += 1;
        }

        read_required_number(bytes, index, command)
    }

    fn extend_previous_timed_event(
        &mut self,
        duration: u32,
        position: usize,
        channel: u32,
    ) -> Result<(), ParseFailure> {
        if let Some((previous_index, last_index)) = self.find_channel_note_pair(channel) {
            let previous = self.events[previous_index];
            let last = self.events[last_index];
            let total_ticks = previous.length_ticks + last.length_ticks + duration;
            let (on_ticks, off_ticks) = self.articulate_duration(total_ticks, channel);
            self.events[previous_index].length_ticks = on_ticks;
            self.events[last_index].length_ticks = off_ticks;
            return Ok(());
        }

        if let Some(last_index) = self.find_last_rest_index(channel) {
            self.events[last_index].length_ticks += duration;
            return Ok(());
        }

        Err(ParseFailure::at(position, ParseError::InvalidTie))
    }

    fn slur_previous_note(&mut self, position: usize, channel: u32) -> Result<(), ParseFailure> {
        if let Some((previous_index, last_index)) = self.find_channel_note_pair(channel) {
            let last = self.events[last_index];
            self.events[previous_index].length_ticks += last.length_ticks;
            self.events[last_index].length_ticks = 0;
            return Ok(());
        }

        Err(ParseFailure::at(position, ParseError::InvalidSlur))
    }

    fn reverse_previous_timed_event(
        &mut self,
        duration: u32,
        position: usize,
        channel: u32,
    ) -> Result<(), ParseFailure> {
        if let Some((previous_index, last_index)) = self.find_channel_note_pair(channel) {
            let previous = self.events[previous_index];
            let last = self.events[last_index];

            if duration > last.length_ticks {
                let remaining = duration - last.length_ticks;

                if remaining >= previous.length_ticks {
                    return Err(ParseFailure::at(position, ParseError::InvalidReverseRest));
                }

                self.events[previous_index].length_ticks -= remaining;
                self.events[last_index].length_ticks = 0;
                return Ok(());
            }

            self.events[last_index].length_ticks -= duration;
            return Ok(());
        }

        if let Some(last_index) = self.find_last_rest_index(channel) {
            if duration > self.events[last_index].length_ticks {
                return Err(ParseFailure::at(position, ParseError::InvalidReverseRest));
            }

            self.events[last_index].length_ticks -= duration;
            return Ok(());
        }

        Err(ParseFailure::at(position, ParseError::InvalidReverseRest))
    }

    fn find_channel_note_pair(&self, channel: u32) -> Option<(usize, usize)> {
        let last_index = self.events.iter().rposition(|event| {
            event.channel == channel
                && matches!(event.kind, EVENT_NOTE_OFF | EVENT_NOISE_OFF)
                && event.value != 0
        })?;
        let last = self.events[last_index];
        let previous_index = self.events[..last_index].iter().rposition(|event| {
            event.channel == channel
                && matches!(event.kind, EVENT_NOTE_ON | EVENT_NOISE_ON)
                && event.value == last.value
        })?;
        Some((previous_index, last_index))
    }

    fn find_last_rest_index(&self, channel: u32) -> Option<usize> {
        self.events.iter().rposition(|event| {
            event.channel == channel
                && matches!(event.kind, EVENT_NOTE_OFF | EVENT_NOISE_OFF)
                && event.value == 0
        })
    }
}

fn preset_envelope_id(preset: u32) -> u32 {
    PRESET_ENVELOPE_ID_BASE + preset
}

fn preset_envelope_definition(preset: u32) -> Option<EnvelopeDefinition> {
    let (speed, values, loop_start) = match preset {
        1 => (1, vec![0], None),
        2 => (1, vec![4], None),
        3 => (1, vec![12, 8, 4, 0], None),
        4 => (2, vec![14, 12, 10, 8, 6, 4, 2, 0], None),
        5 => (1, vec![0, 4, 8, 12, 15], None),
        6 => (2, vec![0, 2, 4, 6, 8, 10, 12, 14, 15], None),
        7 => (1, vec![0, 3, 6, 8, 8, 8, 8], None),
        8 => (1, vec![0, 8, 0], None),
        9 => (1, vec![0, 10, 4, 0], None),
        _ => return None,
    };

    Some(EnvelopeDefinition {
        id: preset_envelope_id(preset),
        speed,
        values,
        loop_start,
    })
}

fn parse_track_selector(bytes: &[u8], index: usize) -> Option<(Vec<u32>, usize)> {
    let mut cursor = index;
    let mut channels = Vec::new();

    while let Some(byte) = peek(bytes, cursor) {
        let channel = match byte {
            b'A' => 0,
            b'B' => 1,
            b'C' => 2,
            b'N' => 3,
            _ => break,
        };
        channels.push(channel);
        cursor += 1;
    }

    if channels.is_empty() {
        return None;
    }

    match peek(bytes, cursor) {
        Some(b' ') | Some(b'\t') => {
            while matches!(peek(bytes, cursor), Some(b' ' | b'\t')) {
                cursor += 1;
            }
            Some((channels, cursor))
        }
        Some(b'\n') | Some(b'\r') | None => Some((channels, cursor)),
        _ => None,
    }
}

fn read_note_accidental(bytes: &[u8], index: &mut usize) -> i32 {
    match peek(bytes, *index) {
        Some(b'+') => {
            *index += 1;
            1
        }
        _ => 0,
    }
}

fn encode_noise_param(volume: u32, noise_mode: u32) -> u32 {
    (noise_mode << 8) | volume.min(15)
}

fn noise_frequency_from_note_number(note: u32) -> u32 {
    600 + note.saturating_mul(40)
}

fn peek(bytes: &[u8], index: usize) -> Option<u8> {
    bytes.get(index).copied()
}

fn skip_comment(bytes: &[u8], index: &mut usize) {
    while let Some(byte) = peek(bytes, *index) {
        *index += 1;
        if byte == b'\n' {
            break;
        }
    }
}

fn skip_spaces_inline(bytes: &[u8], index: &mut usize) {
    while matches!(peek(bytes, *index), Some(b' ' | b'\t' | b'\r')) {
        *index += 1;
    }
}

fn skip_spaces_and_commas(bytes: &[u8], index: &mut usize) {
    while matches!(peek(bytes, *index), Some(b' ' | b'\t' | b'\r' | b',')) {
        *index += 1;
    }
}

fn read_required_number(bytes: &[u8], index: &mut usize, command: char) -> Result<u32, ParseError> {
    read_unsigned_number(bytes, index).ok_or(ParseError::MissingParameter(command))
}

fn read_required_signed_number(
    bytes: &[u8],
    index: &mut usize,
    command: char,
) -> Result<i32, ParseError> {
    read_signed_number(bytes, index).ok_or(ParseError::MissingParameter(command))
}

fn read_unsigned_number(bytes: &[u8], index: &mut usize) -> Option<u32> {
    let start = *index;
    let mut value = 0_u32;

    while let Some(byte) = peek(bytes, *index) {
        if !byte.is_ascii_digit() {
            break;
        }
        value = value
            .saturating_mul(10)
            .saturating_add((byte - b'0') as u32);
        *index += 1;
    }

    if *index == start { None } else { Some(value) }
}

fn read_signed_number(bytes: &[u8], index: &mut usize) -> Option<i32> {
    let sign = match peek(bytes, *index) {
        Some(b'-') => {
            *index += 1;
            -1
        }
        Some(b'+') => {
            *index += 1;
            1
        }
        _ => 1,
    };

    read_unsigned_number(bytes, index).map(|value| (value as i32) * sign)
}

struct LoopSections<'a> {
    body: &'a [u8],
    body_offset: usize,
    break_section: Option<(&'a [u8], usize)>,
    repeat_count: u32,
    next_index: usize,
}

fn split_loop_sections<'a>(
    bytes: &'a [u8],
    start: usize,
    base_offset: usize,
) -> Result<LoopSections<'a>, ParseError> {
    let mut index = start;
    let body_start = start;
    let mut body_end = None;
    let mut break_start = None;
    let mut loop_depth = 1_u32;
    let mut conditional_depth = 0_u32;

    while let Some(byte) = peek(bytes, index) {
        match byte {
            b'[' if conditional_depth == 0 => {
                loop_depth += 1;
            }
            b']' if conditional_depth == 0 => {
                loop_depth -= 1;
                if loop_depth == 0 {
                    let body_end = body_end.unwrap_or(index);
                    let break_section = break_start.map(|section_start| {
                        (&bytes[section_start..index], base_offset + section_start)
                    });
                    index += 1;
                    let repeat_count = read_unsigned_number(bytes, &mut index).unwrap_or(2);
                    return Ok(LoopSections {
                        body: &bytes[body_start..body_end],
                        body_offset: base_offset + body_start,
                        break_section,
                        repeat_count,
                        next_index: index,
                    });
                }
            }
            b'/' if loop_depth == 1 && conditional_depth == 0 && body_end.is_none() => {
                body_end = Some(index);
                break_start = Some(index + 1);
            }
            b'{' => conditional_depth += 1,
            b'}' => conditional_depth = conditional_depth.saturating_sub(1),
            _ => {}
        }

        index += 1;
    }

    Err(ParseError::UnterminatedLoop)
}

struct ConditionalSections<'a> {
    branches: Vec<(&'a [u8], usize)>,
    next_index: usize,
}

fn split_conditional_sections<'a>(
    bytes: &'a [u8],
    start: usize,
    base_offset: usize,
) -> Result<ConditionalSections<'a>, ParseError> {
    let mut index = start;
    let mut section_start = start;
    let mut sections = Vec::new();
    let mut conditional_depth = 1_u32;
    let mut loop_depth = 0_u32;

    while let Some(byte) = peek(bytes, index) {
        match byte {
            b'[' => loop_depth += 1,
            b']' => loop_depth = loop_depth.saturating_sub(1),
            b'{' if loop_depth == 0 => conditional_depth += 1,
            b'}' if loop_depth == 0 => {
                conditional_depth -= 1;
                if conditional_depth == 0 {
                    sections.push((&bytes[section_start..index], base_offset + section_start));
                    return Ok(ConditionalSections {
                        branches: sections,
                        next_index: index + 1,
                    });
                }
            }
            b'/' if conditional_depth == 1 && loop_depth == 0 => {
                sections.push((&bytes[section_start..index], base_offset + section_start));
                section_start = index + 1;
            }
            _ => {}
        }

        index += 1;
    }

    Err(ParseError::UnterminatedConditional)
}

fn scan_structural_diagnostics(source: &str) -> Vec<ParseFailure> {
    let bytes = source.as_bytes();
    let mut diagnostics = Vec::new();
    let mut loop_stack: Vec<usize> = Vec::new();
    let mut conditional_stack: Vec<usize> = Vec::new();
    let mut index = 0;

    while let Some(byte) = peek(bytes, index) {
        match byte {
            b';' => {
                skip_comment(bytes, &mut index);
                continue;
            }
            b'[' => loop_stack.push(index),
            b']' => {
                if loop_stack.pop().is_none() {
                    diagnostics.push(ParseFailure::at(
                        index,
                        ParseError::UnexpectedCharacter(']'),
                    ));
                }
            }
            b'{' => conditional_stack.push(index),
            b'}' => {
                if conditional_stack.pop().is_none() {
                    diagnostics.push(ParseFailure::at(
                        index,
                        ParseError::UnexpectedCharacter('}'),
                    ));
                }
            }
            _ => {}
        }

        index += 1;
    }

    diagnostics.extend(loop_stack.into_iter().map(|position| {
        ParseFailure::with_related_position(position, ParseError::UnterminatedLoop, position)
    }));
    diagnostics.extend(conditional_stack.into_iter().map(|position| {
        ParseFailure::with_related_position(position, ParseError::UnterminatedConditional, position)
    }));

    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note_on(value: u32, length_ticks: u32) -> SequenceEvent {
        SequenceEvent {
            kind: EVENT_NOTE_ON,
            value,
            length_ticks,
            channel: PSG_DEFAULT_CHANNEL,
            param: PSG_DEFAULT_VOLUME,
        }
    }

    fn note_off(value: u32, length_ticks: u32) -> SequenceEvent {
        SequenceEvent {
            kind: EVENT_NOTE_OFF,
            value,
            length_ticks,
            channel: PSG_DEFAULT_CHANNEL,
            param: 0,
        }
    }

    fn tempo(value: u32) -> SequenceEvent {
        SequenceEvent {
            kind: EVENT_TEMPO,
            value,
            length_ticks: 0,
            channel: PSG_DEFAULT_CHANNEL,
            param: 0,
        }
    }

    #[test]
    fn parses_basic_scale() {
        let parsed = parse_mml("o4 l4 cdefgab>c", 64).expect("parse ok");

        assert_eq!(parsed.events[0], note_on(48, 24));
        assert_eq!(parsed.events[2], note_on(50, 24));
        assert_eq!(parsed.events[14], note_on(60, 24));
    }

    #[test]
    fn parses_tempo_and_rest() {
        let parsed = parse_mml("t150 o4 l8 c r d", 64).expect("parse ok");

        assert_eq!(parsed.events[0], tempo(150));
        assert_eq!(parsed.events[1], note_on(48, 12));
        assert_eq!(parsed.events[3], note_off(0, 12));
        assert_eq!(parsed.events[4], note_on(50, 12));
        assert_eq!(parsed.events[5], note_off(50, 0));
    }

    #[test]
    fn parses_global_loop_count() {
        let no_loop = parse_mml("L0 t124 o4 c", 64).expect("parse ok");
        let finite = parse_mml("L3 t124 o4 c", 64).expect("parse ok");
        let infinite = parse_mml("L-1 t124 o4 c", 64).expect("parse ok");

        assert_eq!(no_loop.loop_count, 0);
        assert_eq!(finite.loop_count, 3);
        assert_eq!(infinite.loop_count, -1);
    }

    #[test]
    fn rejects_invalid_global_loop_count() {
        let error = parse_mml("L-2 t124 o4 c", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidLoopCount);
        assert_eq!(error.position, 0);
    }

    #[test]
    fn parses_sharp_with_plus() {
        let parsed = parse_mml("t124 o6 l16 c+ d f+ a+", 64).expect("parse ok");

        assert_eq!(parsed.events[1], note_on(73, 6));
        assert_eq!(parsed.events[3], note_on(74, 6));
        assert_eq!(parsed.events[5], note_on(78, 6));
        assert_eq!(parsed.events[7], note_on(82, 6));
    }

    #[test]
    fn parses_grace_note_with_plus() {
        let parsed = parse_mml("o4 l8 c~c+:3", 16).expect("parse ok");

        assert_eq!(parsed.events[2].kind, EVENT_NOTE_ON);
        assert_eq!(parsed.events[2].value, 49);
        assert_eq!(parsed.events[2].length_ticks, 3);
    }

    #[test]
    fn parses_line_based_tone_channels() {
        let parsed = parse_mml("A o4 l8 c\nB o3 l8 g\nC o2 l8 c", 64).expect("parse ok");

        assert_eq!(parsed.events[0].channel, 0);
        assert_eq!(parsed.events[0].value, 48);
        assert_eq!(parsed.events[0].param, PSG_DEFAULT_VOLUME);
        assert_eq!(parsed.events[2].channel, 1);
        assert_eq!(parsed.events[2].value, 43);
        assert_eq!(parsed.events[4].channel, 2);
        assert_eq!(parsed.events[4].value, 24);
    }

    #[test]
    fn parses_line_based_noise_channel() {
        let parsed = parse_mml("N l8 o4 c r", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_NOISE_ON);
        assert_eq!(parsed.events[0].channel, 3);
        assert!(parsed.events[0].value > 0);
        assert_eq!(
            parsed.events[0].param,
            encode_noise_param(PSG_DEFAULT_VOLUME, PSG_NOISE_MODE_WHITE)
        );
        assert_eq!(parsed.events[1].kind, EVENT_NOISE_OFF);
        assert_eq!(parsed.events[1].channel, 3);
        assert_eq!(parsed.events[1].value, parsed.events[0].value);
        assert_eq!(parsed.events[2].kind, EVENT_NOISE_OFF);
        assert_eq!(parsed.events[2].channel, 3);
        assert_eq!(parsed.events[2].value, 0);
    }

    #[test]
    fn parses_track_selector_after_comment_line() {
        let parsed = parse_mml("t132\n;A o4 l8 c\nN l8 v10 c r", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_TEMPO);
        assert_eq!(parsed.events[1].kind, EVENT_VOLUME);
        assert_eq!(parsed.events[1].channel, PSG_NOISE_CHANNEL);
        assert_eq!(parsed.events[2].kind, EVENT_NOISE_ON);
        assert_eq!(parsed.events[2].channel, PSG_NOISE_CHANNEL);
    }

    #[test]
    fn parses_noise_mode_and_volume_events() {
        let parsed = parse_mml("N v10 w0 c", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_VOLUME);
        assert_eq!(parsed.events[0].value, 10);
        assert_eq!(parsed.events[0].channel, PSG_NOISE_CHANNEL);
        assert_eq!(parsed.events[0].param, PSG_NOISE_MODE_WHITE);
        assert_eq!(parsed.events[1].kind, EVENT_VOLUME);
        assert_eq!(parsed.events[1].value, 10);
        assert_eq!(parsed.events[1].channel, PSG_NOISE_CHANNEL);
        assert_eq!(parsed.events[1].param, PSG_NOISE_MODE_PERIODIC);
        assert_eq!(
            parsed.events[2].param,
            encode_noise_param(10, PSG_NOISE_MODE_PERIODIC)
        );
    }

    #[test]
    fn parses_pan_events() {
        let parsed = parse_mml("A p2 c\nN p1 c", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_PAN);
        assert_eq!(parsed.events[0].value, 2);
        assert_eq!(parsed.events[0].channel, 0);
        assert_eq!(parsed.events[1].kind, EVENT_NOTE_ON);
        assert_eq!(parsed.events[2].kind, EVENT_NOTE_OFF);
        assert_eq!(parsed.events[3].kind, EVENT_PAN);
        assert_eq!(parsed.events[3].value, 1);
        assert_eq!(parsed.events[3].channel, PSG_NOISE_CHANNEL);
    }

    #[test]
    fn rejects_invalid_noise_mode() {
        let error = parse_mml("N w2 c", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidNoiseMode);
        assert_eq!(error.position, 2);
    }

    #[test]
    fn rejects_invalid_pan() {
        let error = parse_mml("p4 c", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidPan);
        assert_eq!(error.position, 0);
    }

    #[test]
    fn parses_envelope_definition_and_selection() {
        let parsed = parse_mml("@E1={2,0,4,8,255,1}\nA @E1 v12 c", 64).expect("parse ok");

        assert_eq!(parsed.envelopes.len(), 1);
        assert_eq!(parsed.envelopes[0].id, 1);
        assert_eq!(parsed.envelopes[0].speed, 2);
        assert_eq!(parsed.envelopes[0].values, vec![0, 4, 8]);
        assert_eq!(parsed.envelopes[0].loop_start, Some(1));

        assert_eq!(parsed.events[0].kind, EVENT_AY_HARDWARE_ENVELOPE_ENABLE);
        assert_eq!(parsed.events[0].value, 0);
        assert_eq!(parsed.events[1].kind, EVENT_ENVELOPE_SELECT);
        assert_eq!(parsed.events[1].value, 1);
        assert_eq!(parsed.events[1].channel, 0);
        assert_eq!(parsed.events[2].kind, EVENT_VOLUME);
        assert_eq!(parsed.events[3].kind, EVENT_NOTE_ON);
    }

    #[test]
    fn parses_pitch_envelope_definition_and_selection() {
        let parsed = parse_mml("@p1={3000,1,-150,0}\nA @p1 c", 64).expect("parse ok");

        assert_eq!(parsed.pitch_envelopes.len(), 1);
        assert_eq!(parsed.pitch_envelopes[0].id, 1);
        assert_eq!(parsed.pitch_envelopes[0].initial_offset, 3000);
        assert_eq!(parsed.pitch_envelopes[0].speed, 1);
        assert_eq!(parsed.pitch_envelopes[0].step, -150);
        assert_eq!(parsed.pitch_envelopes[0].delay, 0);

        assert_eq!(parsed.events[0].kind, EVENT_PITCH_ENVELOPE_SELECT);
        assert_eq!(parsed.events[0].value, 1);
    }

    #[test]
    fn parses_ay_hardware_envelope_commands() {
        let parsed = parse_mml("A EP512 EH9 EE1 c", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_AY_HARDWARE_ENVELOPE_PERIOD);
        assert_eq!(parsed.events[0].value, 512);
        assert_eq!(parsed.events[1].kind, EVENT_AY_HARDWARE_ENVELOPE_SHAPE);
        assert_eq!(parsed.events[1].value, 9);
        assert_eq!(parsed.events[2].kind, EVENT_AY_HARDWARE_ENVELOPE_ENABLE);
        assert_eq!(parsed.events[2].value, 1);
        assert_eq!(parsed.events[3].kind, EVENT_NOTE_ON);
    }

    #[test]
    fn parses_ay_mixer_commands() {
        let parsed = parse_mml("A MT5 MN1 c\nN v12 c", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_AY_MIXER_TONE_MASK);
        assert_eq!(parsed.events[0].value, 5);
        assert_eq!(parsed.events[1].kind, EVENT_AY_MIXER_NOISE_MASK);
        assert_eq!(parsed.events[1].value, 1);
    }

    #[test]
    fn rejects_invalid_ay_mixer_noise_mask() {
        let error = parse_mml("MN8", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidAyMixerNoiseMask);
    }

    #[test]
    fn selecting_software_envelope_disables_ay_hardware_envelope() {
        let parsed = parse_mml("A EE1 @E1={1,0,4,8}\nA @E1 c", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_AY_HARDWARE_ENVELOPE_ENABLE);
        assert_eq!(parsed.events[0].value, 1);
        assert_eq!(parsed.events[1].kind, EVENT_AY_HARDWARE_ENVELOPE_ENABLE);
        assert_eq!(parsed.events[1].value, 0);
        assert_eq!(parsed.events[2].kind, EVENT_ENVELOPE_SELECT);
        assert_eq!(parsed.events[2].value, 1);
    }

    #[test]
    fn rejects_invalid_ay_hardware_envelope_enable() {
        let error = parse_mml("A EE2 c", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidAyHardwareEnvelopeEnable);
    }

    #[test]
    fn rejects_invalid_pitch_envelope_definition() {
        let error = parse_mml("@p1={3000,0,-150,0}\nA c", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidPitchEnvelopeDefinition);
    }

    #[test]
    fn parses_s_preset_envelope_selection() {
        let parsed = parse_mml("A S3 v12 c", 64).expect("parse ok");

        assert_eq!(parsed.envelopes.len(), 1);
        assert_eq!(parsed.envelopes[0].id, preset_envelope_id(3));
        assert_eq!(parsed.envelopes[0].speed, 1);
        assert_eq!(parsed.envelopes[0].values, vec![12, 8, 4, 0]);

        assert_eq!(parsed.events[0].kind, EVENT_AY_HARDWARE_ENVELOPE_ENABLE);
        assert_eq!(parsed.events[0].value, 0);
        assert_eq!(parsed.events[1].kind, EVENT_ENVELOPE_SELECT);
        assert_eq!(parsed.events[1].value, preset_envelope_id(3));
        assert_eq!(parsed.events[1].channel, 0);
        assert_eq!(parsed.events[2].kind, EVENT_VOLUME);
        assert_eq!(parsed.events[3].kind, EVENT_NOTE_ON);
    }

    #[test]
    fn s0_clears_selected_envelope() {
        let parsed = parse_mml("A @E1 S0 c", 64).expect("parse ok");

        assert_eq!(parsed.events[0].kind, EVENT_AY_HARDWARE_ENVELOPE_ENABLE);
        assert_eq!(parsed.events[0].value, 0);
        assert_eq!(parsed.events[1].kind, EVENT_ENVELOPE_SELECT);
        assert_eq!(parsed.events[1].value, 1);
        assert_eq!(parsed.events[2].kind, EVENT_AY_HARDWARE_ENVELOPE_ENABLE);
        assert_eq!(parsed.events[2].value, 0);
        assert_eq!(parsed.events[3].kind, EVENT_ENVELOPE_SELECT);
        assert_eq!(parsed.events[3].value, 0);
    }

    #[test]
    fn rejects_invalid_s_preset_selection() {
        let error = parse_mml("A S99 c", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidEnvelopeSelection);
        assert_eq!(error.position, 2);
    }

    #[test]
    fn rejects_invalid_envelope_definition() {
        let error = parse_mml("@E1={0,0,4}\nA c", 64).expect_err("parse error");

        assert_eq!(error.error, ParseError::InvalidEnvelopeDefinition);
        assert_eq!(error.position, 0);
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
    fn parses_quantize_and_early_release() {
        let quantized = parse_mml("o4 l8 Q6 c", 16).expect("parse ok");
        let released = parse_mml("o4 l8 q3 c", 16).expect("parse ok");

        assert_eq!(quantized.events[0].length_ticks, 9);
        assert_eq!(quantized.events[1].length_ticks, 3);
        assert_eq!(released.events[0].length_ticks, 9);
        assert_eq!(released.events[1].length_ticks, 3);
    }

    #[test]
    fn parses_tick_length_commands() {
        let parsed = parse_mml("C:96 l:18 o4 c:15 r:9", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 15);
        assert_eq!(parsed.events[1].length_ticks, 0);
        assert_eq!(parsed.events[2].length_ticks, 9);
    }

    #[test]
    fn extends_note_and_rest_with_tie() {
        let note = parse_mml("o4 l8 c^16", 16).expect("parse ok");
        let rest = parse_mml("l8 r^16", 16).expect("parse ok");

        assert_eq!(note.events[0].length_ticks, 18);
        assert_eq!(note.events[1].length_ticks, 0);
        assert_eq!(rest.events[0].length_ticks, 18);
    }

    #[test]
    fn slurs_previous_note() {
        let parsed = parse_mml("o4 l8 c&d", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 12);
        assert_eq!(parsed.events[1].length_ticks, 0);
        assert_eq!(parsed.events[2].length_ticks, 12);
        assert_eq!(parsed.events[3].length_ticks, 0);
    }

    #[test]
    fn parses_reverse_rest_on_note_release() {
        let parsed = parse_mml("o4 l8 q3 cR:2", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 9);
        assert_eq!(parsed.events[1].length_ticks, 1);
    }

    #[test]
    fn parses_reverse_rest_on_rest() {
        let parsed = parse_mml("l8 rR:5", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 7);
    }

    #[test]
    fn parses_grace_note() {
        let parsed = parse_mml("o4 l8 c~d:3", 16).expect("parse ok");

        assert_eq!(parsed.events[0].length_ticks, 9);
        assert_eq!(parsed.events[1].length_ticks, 0);
        assert_eq!(parsed.events[2].kind, EVENT_NOTE_ON);
        assert_eq!(parsed.events[2].value, 50);
        assert_eq!(parsed.events[2].length_ticks, 3);
        assert_eq!(parsed.events[3].kind, EVENT_NOTE_OFF);
        assert_eq!(parsed.events[3].length_ticks, 0);
    }

    #[test]
    fn parses_loop_repetition() {
        let parsed = parse_mml("o4 [c]3", 32).expect("parse ok");

        assert_eq!(parsed.events.len(), 6);
        assert_eq!(parsed.events[0].value, 48);
        assert_eq!(parsed.events[2].value, 48);
        assert_eq!(parsed.events[4].value, 48);
    }

    #[test]
    fn parses_loop_break_section() {
        let parsed = parse_mml("o4 [c/d]3", 64).expect("parse ok");

        assert_eq!(parsed.events.len(), 10);
        assert_eq!(parsed.events[0].value, 48);
        assert_eq!(parsed.events[2].value, 50);
        assert_eq!(parsed.events[4].value, 48);
        assert_eq!(parsed.events[6].value, 50);
        assert_eq!(parsed.events[8].value, 48);
    }

    #[test]
    fn parses_conditional_first_branch_by_default() {
        let parsed = parse_mml("o4 c{d/e/f}g", 32).expect("parse ok");

        assert_eq!(parsed.events.len(), 6);
        assert_eq!(parsed.events[0].value, 48);
        assert_eq!(parsed.events[2].value, 50);
        assert_eq!(parsed.events[4].value, 55);
    }

    #[test]
    fn parses_conditional_selected_branch_with_context() {
        let parsed = parse_mml_with_context("o4 c{d/e/f}g", 32, 2).expect("parse ok");

        assert_eq!(parsed.events.len(), 6);
        assert_eq!(parsed.events[0].value, 48);
        assert_eq!(parsed.events[2].value, 53);
        assert_eq!(parsed.events[4].value, 55);
    }

    #[test]
    fn reports_error_position_for_missing_parameter() {
        let error = parse_mml("o4 C c", 16).expect_err("should fail");

        assert_eq!(error.position, 3);
        assert_eq!(error.error, ParseError::MissingParameter('C'));
    }

    #[test]
    fn reports_nested_error_position() {
        let error = parse_mml("o4 [c/x]2", 32).expect_err("should fail");

        assert_eq!(error.position, 6);
        assert_eq!(error.error, ParseError::UnexpectedCharacter('x'));
    }

    #[test]
    fn collects_multiple_structural_diagnostics() {
        let diagnostics = collect_parse_diagnostics_with_context("o4 ] c { d", 32, 0);

        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].position, 3);
        assert_eq!(diagnostics[0].error, ParseError::UnexpectedCharacter(']'));
        assert_eq!(diagnostics[1].position, 7);
        assert_eq!(diagnostics[1].error, ParseError::UnterminatedConditional);
    }

    #[test]
    fn formats_unsupported_command_hint() {
        let diagnostic = ParseFailure::at(3, ParseError::UnexpectedCharacter('x'));
        let message = format_parse_failure_with_context("o4 x10", &diagnostic, 0);

        assert!(message.contains("unexpected character 'x'"));
        assert!(message.contains("possibly unsupported command 'x'"));
        assert!(message.contains("custom or extended command"));
    }

    #[test]
    fn formats_loop_and_conditional_context_hint() {
        let diagnostic = ParseFailure::at(8, ParseError::UnexpectedCharacter('x'));
        let message = format_parse_failure_with_context("[c{d x", &diagnostic, 2);

        assert!(message.contains("inside loop depth 1"));
        assert!(message.contains("inside conditional depth 1 with selected branch 2"));
    }

    #[test]
    fn attaches_related_opening_position_from_context() {
        let diagnostics = collect_parse_diagnostics_with_context("[c{x/e}]", 32, 0);
        let parser_error = diagnostics
            .iter()
            .find(|entry| entry.error == ParseError::UnexpectedCharacter('x'))
            .expect("parser error");

        assert_eq!(parser_error.related_position, Some(2));
    }

    #[test]
    fn returns_multiple_quick_fixes_for_missing_parameter() {
        let diagnostic = ParseFailure::at(3, ParseError::MissingParameter('C'));
        let fixes = parse_failure_quick_fixes("o4 C c", &diagnostic);

        assert_eq!(fixes.len(), 2);
        assert_eq!(fixes[0].replacement, "C96");
        assert_eq!(fixes[1].replacement, "C:96");
    }

    #[test]
    fn returns_multiple_quick_fixes_for_unsupported_command() {
        let diagnostic = ParseFailure::at(3, ParseError::UnexpectedCharacter('x'));
        let fixes = parse_failure_quick_fixes("o4 x10", &diagnostic);

        assert!(!fixes.is_empty());
        assert!(fixes[0].label.contains("最小"));
        assert!(
            fixes
                .iter()
                .any(|entry| entry.replacement == "o4 l8 c d e f")
        );
    }

    #[test]
    fn rejects_illegal_lengths() {
        assert_eq!(
            parse_mml("l0 c", 16),
            Err(ParseFailure::at(0, ParseError::InvalidLength))
        );
        assert_eq!(
            parse_mml("t0 c", 16),
            Err(ParseFailure::at(0, ParseError::InvalidTempo))
        );
        assert_eq!(
            parse_mml("Q9 c", 16),
            Err(ParseFailure::at(0, ParseError::InvalidQuantize))
        );
        assert_eq!(
            parse_mml("^8", 16),
            Err(ParseFailure::at(0, ParseError::InvalidTie))
        );
        assert_eq!(
            parse_mml("&c", 16),
            Err(ParseFailure::at(0, ParseError::InvalidSlur))
        );
        assert_eq!(
            parse_mml("R8", 16),
            Err(ParseFailure::at(0, ParseError::InvalidReverseRest))
        );
        assert_eq!(
            parse_mml("o4 l8 cR8", 16),
            Err(ParseFailure::at(7, ParseError::InvalidReverseRest))
        );
        assert_eq!(
            parse_mml("[c", 16),
            Err(ParseFailure::at(0, ParseError::UnterminatedLoop))
        );
        assert_eq!(
            parse_mml("{c/d", 16),
            Err(ParseFailure::at(0, ParseError::UnterminatedConditional))
        );
    }
}
