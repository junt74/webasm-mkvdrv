use core::fmt;

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

    if let Some(context) = nesting_context_hint(source, failure.position, conditional_branch_index) {
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
        events: parser.events,
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
        if !diagnostics
            .iter()
            .any(|entry| {
                entry.position == error.position
                    && entry.error == error.error
                    && entry.related_position == error.related_position
            })
        {
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

    if "cdefgabrtloCQqR".contains(*character) {
        return None;
    }

    let suggestion = match character {
        'v' => "reference spec defines v<num> as coarse volume; Stage 1 alternative is to keep pitch/rhythm only until VOL is implemented",
        'V' => "reference spec defines V<num> or V+<num>/V-<num> as fine volume; Stage 1 alternative is to omit it and keep the phrase structure",
        'p' => "reference spec defines p<num> as pan; Stage 1 has no stereo control yet, so remove p<num> and verify the melody first",
        'k' => "reference spec notes k<num> is currently handled like _<num>; Stage 1 alternative is to rewrite it as _<num> once transpose is added",
        'K' => "reference spec defines K<num> as detune; Stage 1 has no detune yet, so keep the note sequence and drop K<num> for now",
        'E' => "reference spec defines E<num> as volume envelope; Stage 1 alternative is to use q or Q for rough articulation only",
        'M' => "reference spec defines M<num> as pitch envelope; Stage 1 alternative is to spell the pitch motion as explicit notes",
        'P' => "reference spec defines P<num> as pan envelope; Stage 1 has no pan lane yet, so omit it for now",
        'G' => "reference spec defines G<num> as portamento; Stage 1 alternative is to approximate it with short connecting notes or ~",
        'D' => "reference spec defines D<num> as drum mode; Stage 1 has no drum-note remap yet, so keep explicit note names only",
        'T' => "reference spec defines T<num> as platform tempo; Stage 1 alternative is to use t<num> BPM tempo",
        'L' => "reference spec defines L as segno; Stage 1 alternative is to expand the repeated section with [] where possible",
        'n' => "direct note-number style is not implemented in this parser; Stage 1 alternative is to rewrite it with o<num> and cdefgab",
        's' => "reference state rules define s<ticks> as shuffle; Stage 1 alternative is to rewrite timing with explicit :ticks lengths",
        'x' => "this looks like a custom or extended command; compare it against _reference/mml_spec/commands.md and keep to Stage 1 core commands first",
        _ => "compare this command against _reference/mml_spec/commands.md; supported Stage 1 core commands are t l o C Q q R and notes cdefgab/r",
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
        if !suggestions.iter().any(|entry| entry.replacement == replacement) {
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
        (Some(loop_position), Some(conditional_position)) => Some((*loop_position).max(*conditional_position)),
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
    ticks_per_whole: u32,
    default_length: u32,
    octave: i32,
    tempo_bpm: u32,
    quantize_numerator: u32,
    quantize_denominator: u32,
    early_release_ticks: u32,
    conditional_branch_index: usize,
    events: Vec<SequenceEvent>,
}

impl Parser {
    fn new(max_events: usize, conditional_branch_index: usize) -> Self {
        Self {
            max_events,
            ticks_per_beat: DEFAULT_TICKS_PER_BEAT,
            ticks_per_whole: DEFAULT_TICKS_PER_WHOLE,
            default_length: DEFAULT_NOTE_LENGTH,
            octave: 4 + MML_OCTAVE_OFFSET,
            tempo_bpm: DEFAULT_TEMPO_BPM,
            quantize_numerator: DEFAULT_QUANTIZE_NUMERATOR,
            quantize_denominator: DEFAULT_QUANTIZE_DENOMINATOR,
            early_release_ticks: 0,
            conditional_branch_index,
            events: Vec::new(),
        }
    }

    fn parse_bytes(&mut self, bytes: &[u8], base_offset: usize) -> Result<(), ParseFailure> {
        let mut index = 0;

        while let Some(byte) = peek(bytes, index) {
            let position = base_offset + index;

            match byte {
                b' ' | b'\t' | b'\n' | b'\r' | b'|' => {
                    index += 1;
                }
                b';' => skip_comment(bytes, &mut index),
                b't' => {
                    index += 1;
                    let tempo = read_required_number(bytes, &mut index, 't')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if tempo == 0 {
                        return Err(ParseFailure::at(position, ParseError::InvalidTempo));
                    }
                    self.tempo_bpm = tempo;
                    self.push_event(EVENT_TEMPO, tempo, 0)?;
                }
                b'l' => {
                    index += 1;
                    self.default_length = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                }
                b'C' => {
                    index += 1;
                    let ticks = self
                        .read_tick_parameter(bytes, &mut index, 'C')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    if ticks == 0 {
                        return Err(ParseFailure::at(position, ParseError::InvalidLength));
                    }
                    self.ticks_per_whole = ticks;
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
                    self.octave = octave;
                }
                b'>' => {
                    index += 1;
                    self.octave += 1;
                }
                b'<' => {
                    index += 1;
                    self.octave -= 1;
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
                    self.quantize_numerator = quantize;
                    self.quantize_denominator = DEFAULT_QUANTIZE_DENOMINATOR;
                    self.early_release_ticks = 0;
                }
                b'q' => {
                    index += 1;
                    let early_release = self
                        .read_tick_parameter(bytes, &mut index, 'q')
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.quantize_numerator = DEFAULT_QUANTIZE_DENOMINATOR;
                    self.quantize_denominator = DEFAULT_QUANTIZE_DENOMINATOR;
                    self.early_release_ticks = early_release;
                }
                b'c' | b'd' | b'e' | b'f' | b'g' | b'a' | b'b' => {
                    let note = self.read_note_number(byte);
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    let (on_ticks, off_ticks) = self.articulate_duration(duration);
                    self.push_event(EVENT_NOTE_ON, note, on_ticks)?;
                    self.push_event(EVENT_NOTE_OFF, note, off_ticks)?;
                }
                b'r' => {
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.push_event(EVENT_NOTE_OFF, 0, duration)?;
                }
                b'R' => {
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.reverse_previous_timed_event(duration, position)?;
                }
                b'~' => {
                    index += 1;
                    let note_token = peek(bytes, index).ok_or(ParseFailure::at(
                        position,
                        ParseError::UnexpectedCharacter('\0'),
                    ))?;
                    let note = match note_token {
                        b'c' | b'd' | b'e' | b'f' | b'g' | b'a' | b'b' => {
                            let value = self.read_note_number(note_token);
                            index += 1;
                            value
                        }
                        other => {
                            return Err(ParseFailure::at(
                                base_offset + index,
                                ParseError::UnexpectedCharacter(other as char),
                            ));
                        }
                    };
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.reverse_previous_timed_event(duration, position)?;
                    let (on_ticks, off_ticks) = self.articulate_duration(duration);
                    self.push_event(EVENT_NOTE_ON, note, on_ticks)?;
                    self.push_event(EVENT_NOTE_OFF, note, off_ticks)?;
                }
                b'^' => {
                    index += 1;
                    let duration = self
                        .read_duration(bytes, &mut index)
                        .map_err(|error| ParseFailure::at(position, error))?;
                    self.extend_previous_timed_event(duration, position)?;
                }
                b'&' => {
                    index += 1;
                    self.slur_previous_note(position)?;
                }
                b'[' => {
                    index += 1;
                    let sections =
                        split_loop_sections(bytes, index, base_offset).map_err(|error| {
                            ParseFailure::at(position, error)
                        })?;
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
                    let sections =
                        split_conditional_sections(bytes, index, base_offset).map_err(|error| {
                            ParseFailure::at(position, error)
                        })?;
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

    fn push_event(
        &mut self,
        kind: u32,
        value: u32,
        length_ticks: u32,
    ) -> Result<(), ParseFailure> {
        if self.events.len() >= self.max_events {
            return Err(ParseFailure::at(0, ParseError::TooManyEvents));
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

    fn read_duration(&self, bytes: &[u8], index: &mut usize) -> Result<u32, ParseError> {
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
                self.ticks_per_whole / divider
            }
            _ => self.default_length,
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
    ) -> Result<(), ParseFailure> {
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

        Err(ParseFailure::at(position, ParseError::InvalidTie))
    }

    fn slur_previous_note(&mut self, position: usize) -> Result<(), ParseFailure> {
        if self.events.len() < 2 {
            return Err(ParseFailure::at(position, ParseError::InvalidSlur));
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

        Err(ParseFailure::at(position, ParseError::InvalidSlur))
    }

    fn reverse_previous_timed_event(
        &mut self,
        duration: u32,
        position: usize,
    ) -> Result<(), ParseFailure> {
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
        }

        if let Some(last) = self.events.last_mut()
            && last.kind == EVENT_NOTE_OFF
            && last.value == 0
        {
            if duration > last.length_ticks {
                return Err(ParseFailure::at(position, ParseError::InvalidReverseRest));
            }

            last.length_ticks -= duration;
            return Ok(());
        }

        Err(ParseFailure::at(position, ParseError::InvalidReverseRest))
    }
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

fn read_required_number(
    bytes: &[u8],
    index: &mut usize,
    command: char,
) -> Result<u32, ParseError> {
    read_unsigned_number(bytes, index).ok_or(ParseError::MissingParameter(command))
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

    if *index == start {
        None
    } else {
        Some(value)
    }
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
                        (
                            &bytes[section_start..index],
                            base_offset + section_start,
                        )
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
                    diagnostics.push(ParseFailure::at(index, ParseError::UnexpectedCharacter(']')));
                }
            }
            b'{' => conditional_stack.push(index),
            b'}' => {
                if conditional_stack.pop().is_none() {
                    diagnostics.push(ParseFailure::at(index, ParseError::UnexpectedCharacter('}')));
                }
            }
            _ => {}
        }

        index += 1;
    }

    diagnostics.extend(
        loop_stack
            .into_iter()
            .map(|position| ParseFailure::with_related_position(
                position,
                ParseError::UnterminatedLoop,
                position,
            )),
    );
    diagnostics.extend(
        conditional_stack
            .into_iter()
            .map(|position| ParseFailure::with_related_position(
                position,
                ParseError::UnterminatedConditional,
                position,
            )),
    );

    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_scale() {
        let parsed = parse_mml("o4 l4 cdefgab>c", 64).expect("parse ok");

        assert_eq!(
            parsed.events[0],
            SequenceEvent {
                kind: EVENT_NOTE_ON,
                value: 36,
                length_ticks: 24
            }
        );
        assert_eq!(
            parsed.events[2],
            SequenceEvent {
                kind: EVENT_NOTE_ON,
                value: 38,
                length_ticks: 24
            }
        );
        assert_eq!(
            parsed.events[14],
            SequenceEvent {
                kind: EVENT_NOTE_ON,
                value: 48,
                length_ticks: 24
            }
        );
    }

    #[test]
    fn parses_tempo_and_rest() {
        let parsed = parse_mml("t150 o4 l8 c r d", 64).expect("parse ok");

        assert_eq!(
            parsed.events[0],
            SequenceEvent {
                kind: EVENT_TEMPO,
                value: 150,
                length_ticks: 0
            }
        );
        assert_eq!(
            parsed.events[1],
            SequenceEvent {
                kind: EVENT_NOTE_ON,
                value: 36,
                length_ticks: 12
            }
        );
        assert_eq!(
            parsed.events[3],
            SequenceEvent {
                kind: EVENT_NOTE_OFF,
                value: 0,
                length_ticks: 12
            }
        );
        assert_eq!(
            parsed.events[4],
            SequenceEvent {
                kind: EVENT_NOTE_ON,
                value: 38,
                length_ticks: 12
            }
        );
        assert_eq!(
            parsed.events[5],
            SequenceEvent {
                kind: EVENT_NOTE_OFF,
                value: 38,
                length_ticks: 0
            }
        );
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
        assert_eq!(parsed.events[2].value, 38);
        assert_eq!(parsed.events[2].length_ticks, 3);
        assert_eq!(parsed.events[3].kind, EVENT_NOTE_OFF);
        assert_eq!(parsed.events[3].length_ticks, 0);
    }

    #[test]
    fn parses_loop_repetition() {
        let parsed = parse_mml("o4 [c]3", 32).expect("parse ok");

        assert_eq!(parsed.events.len(), 6);
        assert_eq!(parsed.events[0].value, 36);
        assert_eq!(parsed.events[2].value, 36);
        assert_eq!(parsed.events[4].value, 36);
    }

    #[test]
    fn parses_loop_break_section() {
        let parsed = parse_mml("o4 [c/d]3", 64).expect("parse ok");

        assert_eq!(parsed.events.len(), 10);
        assert_eq!(parsed.events[0].value, 36);
        assert_eq!(parsed.events[2].value, 38);
        assert_eq!(parsed.events[4].value, 36);
        assert_eq!(parsed.events[6].value, 38);
        assert_eq!(parsed.events[8].value, 36);
    }

    #[test]
    fn parses_conditional_first_branch_by_default() {
        let parsed = parse_mml("o4 c{d/e/f}g", 32).expect("parse ok");

        assert_eq!(parsed.events.len(), 6);
        assert_eq!(parsed.events[0].value, 36);
        assert_eq!(parsed.events[2].value, 38);
        assert_eq!(parsed.events[4].value, 43);
    }

    #[test]
    fn parses_conditional_selected_branch_with_context() {
        let parsed = parse_mml_with_context("o4 c{d/e/f}g", 32, 2).expect("parse ok");

        assert_eq!(parsed.events.len(), 6);
        assert_eq!(parsed.events[0].value, 36);
        assert_eq!(parsed.events[2].value, 41);
        assert_eq!(parsed.events[4].value, 43);
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
        let diagnostic = ParseFailure::at(3, ParseError::UnexpectedCharacter('v'));
        let message = format_parse_failure_with_context("o4 v10", &diagnostic, 0);

        assert!(message.contains("unexpected character 'v'"));
        assert!(message.contains("possibly unsupported command 'v'"));
        assert!(message.contains("v<num> as coarse volume"));
        assert!(message.contains("try rewriting it like:"));
        assert!(message.contains("o4 l8 c d e f"));
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
        let diagnostic = ParseFailure::at(3, ParseError::UnexpectedCharacter('v'));
        let fixes = parse_failure_quick_fixes("o4 v10", &diagnostic);

        assert!(fixes.len() >= 2);
        assert_eq!(fixes[0].label, "仕様に近い最小例");
        assert!(fixes.iter().any(|entry| entry.replacement == "o4 l8 c d e f"));
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
