use super::Provider;

pub(crate) fn clean_key(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

pub(crate) fn last_four(value: &str) -> String {
    value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

pub(crate) fn key_context(user_id: i64, provider: Provider) -> String {
    format!("user:{user_id}:{}", provider.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_hints_do_not_expose_the_key() {
        assert_eq!(last_four("sk-abcdefgh"), "efgh");
    }
}
