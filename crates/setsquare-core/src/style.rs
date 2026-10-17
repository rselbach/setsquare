//! draw.io style strings, such as `rounded=1;whiteSpace=wrap;fillColor=#dae8fc;`.
//!
//! A style keeps every token in its original order so that a file round-trips unchanged,
//! including keys this crate does not understand.

use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Token {
    /// A bare token such as `ellipse` or `swimlane`, which names a predefined style.
    Name(String),
    Pair(String, String),
}

/// An ordered set of style tokens.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Style {
    tokens: Vec<Token>,
    /// Set when the string starts with `;`, which tells draw.io not to start from the
    /// default vertex or edge style.
    skip_defaults: bool,
}

impl Style {
    /// Parses a style string. Parsing never fails; empty tokens are dropped.
    pub fn parse(s: &str) -> Style {
        let tokens = s
            .split(';')
            .filter(|t| !t.is_empty())
            .map(|t| match t.split_once('=') {
                Some((k, v)) => Token::Pair(k.to_owned(), v.to_owned()),
                None => Token::Name(t.to_owned()),
            })
            .collect();
        Style {
            tokens,
            skip_defaults: s.starts_with(';'),
        }
    }

    /// Returns the tokens in order: a named style as `(name, None)`, a pair as
    /// `(key, Some(value))`.
    pub(crate) fn entries(&self) -> impl Iterator<Item = (&str, Option<&str>)> {
        self.tokens.iter().map(|t| match t {
            Token::Name(n) => (n.as_str(), None),
            Token::Pair(k, v) => (k.as_str(), Some(v.as_str())),
        })
    }

    /// Reports whether the style opts out of the default vertex or edge style.
    pub(crate) fn skips_defaults(&self) -> bool {
        self.skip_defaults
    }

    /// Returns the value for `key`. When a key repeats, the last value wins, as in draw.io.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.tokens.iter().rev().find_map(|t| match t {
            Token::Pair(k, v) if k == key => Some(v.as_str()),
            _ => None,
        })
    }

    /// Reports whether `key` is set to `1`.
    pub fn flag(&self, key: &str) -> bool {
        self.get(key) == Some("1")
    }

    /// Returns the value for `key` as a number.
    pub fn number(&self, key: &str) -> Option<f64> {
        self.get(key)?.parse().ok()
    }

    /// Reports whether the style includes the bare token `name`, such as `ellipse`.
    pub fn has_name(&self, name: &str) -> bool {
        self.tokens
            .iter()
            .any(|t| matches!(t, Token::Name(n) if n == name))
    }

    /// Sets `key` to `value`, replacing an existing value in place or appending a new one.
    pub fn set(&mut self, key: &str, value: impl Into<String>) {
        let pair = Token::Pair(key.to_owned(), value.into());
        let is_key = |t: &Token| matches!(t, Token::Pair(k, _) if k == key);
        let Some(first) = self.tokens.iter().position(is_key) else {
            self.tokens.push(pair);
            return;
        };
        self.tokens[first] = pair;
        let mut index = 0;
        self.tokens.retain(|t| {
            index += 1;
            index - 1 <= first || !is_key(t)
        });
    }

    /// Removes every value for `key`.
    pub fn remove(&mut self, key: &str) {
        self.tokens
            .retain(|t| !matches!(t, Token::Pair(k, _) if k == key));
    }
}

impl fmt::Display for Style {
    /// Writes the style in draw.io's form, with a `;` after every token.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.skip_defaults {
            f.write_str(";")?;
        }
        for t in &self.tokens {
            match t {
                Token::Name(n) => write!(f, "{n};")?,
                Token::Pair(k, v) => write!(f, "{k}={v};")?,
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_display_round_trip() {
        let tests = [
            (
                "plain pairs",
                "rounded=1;whiteSpace=wrap;html=1;",
                "rounded=1;whiteSpace=wrap;html=1;",
            ),
            (
                "leading name",
                "ellipse;fillColor=#dae8fc;",
                "ellipse;fillColor=#dae8fc;",
            ),
            ("missing trailing separator", "text;html=1", "text;html=1;"),
            (
                "unknown keys survive",
                "mystery=42;shape=cylinder3;",
                "mystery=42;shape=cylinder3;",
            ),
            (
                "values may contain equals",
                "link=data:action/json,{\"a\"=1};",
                "link=data:action/json,{\"a\"=1};",
            ),
            ("empty", "", ""),
            (
                "leading separator skips defaults",
                ";rounded=1;",
                ";rounded=1;",
            ),
        ];
        for (name, input, want) in tests {
            assert_eq!(Style::parse(input).to_string(), want, "{name}");
        }
    }

    #[test]
    fn get_reads_the_last_value() {
        let s = Style::parse("ellipse;strokeWidth=1;strokeWidth=3;rounded=1;");
        assert_eq!(s.get("strokeWidth"), Some("3"));
        assert_eq!(s.number("strokeWidth"), Some(3.0));
        assert!(s.flag("rounded"));
        assert!(s.has_name("ellipse"));
        assert!(!s.has_name("rounded"));
        assert_eq!(s.get("fillColor"), None);
    }

    #[test]
    fn set_replaces_in_place_and_collapses_duplicates() {
        let mut s = Style::parse("a=1;b=2;a=3;c=4;");
        s.set("a", "9");
        assert_eq!(s.to_string(), "a=9;b=2;c=4;");
        s.set("d", "5");
        assert_eq!(s.to_string(), "a=9;b=2;c=4;d=5;");
        s.remove("b");
        assert_eq!(s.to_string(), "a=9;c=4;d=5;");
    }
}
