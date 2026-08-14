//! Parses the `.http`/`.rest` REST-client file format: `@name = value`
//! variables anywhere in the file, `### Name` request separators, a
//! `METHOD url` request line, `Key: Value` headers, a blank line, then an
//! optional body running to the next `###` or EOF.

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Default)]
pub struct ParsedRequest {
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedFile {
    pub variables: HashMap<String, String>,
    pub requests: Vec<ParsedRequest>,
}

fn is_comment(line: &str) -> bool {
    let t = line.trim_start();
    (t.starts_with('#') && !t.starts_with("###")) || t.starts_with("//")
}

pub fn parse(content: &str) -> ParsedFile {
    let mut variables = HashMap::new();
    for line in content.lines() {
        if let Some(rest) = line.trim().strip_prefix('@') {
            if let Some((name, value)) = rest.split_once('=') {
                variables.insert(name.trim().to_string(), value.trim().to_string());
            }
        }
    }

    let mut blocks: Vec<(Option<String>, Vec<&str>)> = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();
    let mut in_block = false;

    for line in content.lines() {
        if let Some(rest) = line.trim_start().strip_prefix("###") {
            if in_block {
                blocks.push((current_name.take(), std::mem::take(&mut current_lines)));
            }
            in_block = true;
            let name = rest.trim();
            current_name = (!name.is_empty()).then(|| name.to_string());
            continue;
        }
        if in_block {
            current_lines.push(line);
        }
    }
    if in_block {
        blocks.push((current_name, current_lines));
    }

    let requests = blocks
        .into_iter()
        .enumerate()
        .filter_map(|(index, (name, lines))| {
            parse_block(&lines).map(|request| ParsedRequest { name: name.unwrap_or_else(|| format!("Request {}", index + 1)), ..request })
        })
        .collect();

    ParsedFile { variables, requests }
}

fn parse_block(lines: &[&str]) -> Option<ParsedRequest> {
    let mut iter = lines.iter();

    let request_line = loop {
        let line = iter.next()?;
        let t = line.trim();
        if t.is_empty() || is_comment(line) || t.starts_with('@') {
            continue;
        }
        break t;
    };

    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_uppercase();
    let url = parts.next()?.to_string();

    let mut headers = Vec::new();
    for line in iter.by_ref() {
        let t = line.trim();
        if t.is_empty() {
            break;
        }
        if is_comment(line) || t.starts_with('@') {
            continue;
        }
        if let Some((key, value)) = t.split_once(':') {
            headers.push((key.trim().to_string(), value.trim().to_string()));
        }
    }

    let body_text = iter.copied().collect::<Vec<_>>().join("\n");
    let body = (!body_text.trim().is_empty()).then(|| body_text.trim().to_string());

    Some(ParsedRequest { name: String::new(), method, url, headers, body })
}

/// `{{name}}` references in `text`, in first-seen order, de-duplicated.
pub fn referenced_variables(text: &str) -> Vec<String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}").unwrap());
    let mut seen = HashSet::new();
    re.captures_iter(text).filter_map(|cap| seen.insert(cap[1].to_string()).then(|| cap[1].to_string())).collect()
}

/// Replaces every `{{name}}` with `variables[name]`; unresolved placeholders are left as-is.
pub fn interpolate(text: &str, variables: &HashMap<String, String>) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}").unwrap());
    re.replace_all(text, |caps: &regex::Captures| variables.get(&caps[1]).cloned().unwrap_or_else(|| caps[0].to_string())).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_requests_and_preserves_multiline_body() {
        let parsed = parse("@host = https://example.test\n### Create\nPOST {{host}}/items\nContent-Type: application/json\n\n{\n  \"name\": \"demo\"\n}\n");
        assert_eq!(parsed.variables.get("host"), Some(&"https://example.test".to_string()));
        assert_eq!(parsed.requests.len(), 1);
        assert_eq!(parsed.requests[0].name, "Create");
        assert_eq!(parsed.requests[0].method, "POST");
        assert_eq!(parsed.requests[0].headers, vec![("Content-Type".to_string(), "application/json".to_string())]);
        assert_eq!(parsed.requests[0].body.as_deref(), Some("{\n  \"name\": \"demo\"\n}"));
    }

    #[test]
    fn interpolation_leaves_unknown_variables_untouched() {
        let variables = HashMap::from([(String::from("host"), String::from("https://example.test"))]);
        assert_eq!(interpolate("{{host}}/{{missing}}", &variables), "https://example.test/{{missing}}");
        assert_eq!(referenced_variables("{{host}} {{host}} {{missing}}"), vec!["host", "missing"]);
    }
}
