use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Resolves a database-stored relative path against the library root, refusing
/// anything that escapes it.
///
/// Paths in the database are not user input in the normal sense, but they are
/// derived from filenames on a share that other people can write to, and a
/// symlink or a `..` component would otherwise turn "read a document" into
/// "read any file the server user can reach". This is checked twice: the
/// components are rejected up front, and the canonicalised result is confirmed
/// to still live under the root, which is what catches symlinks.
pub fn resolve_in_root(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let candidate = Path::new(relative);

    if candidate.is_absolute() {
        return Err(AppError::BadRequest("absolute paths are not allowed".into()));
    }

    for component in candidate.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::BadRequest(
                    "path escapes the library root".into(),
                ));
            }
        }
    }

    let joined = root.join(candidate);

    // canonicalize resolves symlinks, so a link inside the library pointing at
    // /etc/shadow fails the containment check below rather than being served.
    let resolved = joined.canonicalize().map_err(|_| AppError::NotFound)?;
    let root = root.canonicalize().map_err(|_| AppError::NotFound)?;

    if !resolved.starts_with(&root) {
        return Err(AppError::BadRequest(
            "path escapes the library root".into(),
        ));
    }

    Ok(resolved)
}

/// Best-effort filename for Content-Disposition, falling back to the document
/// id when the stored path has no usable final component.
pub fn download_filename(relative: &str, document_id: i64) -> String {
    Path::new(relative)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| format!("document-{document_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("papers")).unwrap();
        std::fs::write(dir.path().join("papers/a.pdf"), b"pdf").unwrap();
        dir
    }

    #[test]
    fn resolves_a_normal_relative_path() {
        let dir = root();
        let resolved = resolve_in_root(dir.path(), "papers/a.pdf").unwrap();
        assert!(resolved.ends_with("papers/a.pdf"));
    }

    #[test]
    fn rejects_parent_directory_traversal() {
        let dir = root();
        assert!(resolve_in_root(dir.path(), "../../etc/passwd").is_err());
        assert!(resolve_in_root(dir.path(), "papers/../../escape").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        let dir = root();
        assert!(resolve_in_root(dir.path(), "/etc/passwd").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_pointing_outside_the_root() {
        let dir = root();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), b"secret").unwrap();

        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            dir.path().join("papers/link.pdf"),
        )
        .unwrap();

        // The path has no suspicious components, so only the canonicalised
        // containment check can catch this one.
        assert!(resolve_in_root(dir.path(), "papers/link.pdf").is_err());
    }

    #[test]
    fn missing_files_are_not_found_rather_than_bad_request() {
        let dir = root();
        let err = resolve_in_root(dir.path(), "papers/missing.pdf").unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[test]
    fn download_filename_uses_the_final_component() {
        assert_eq!(download_filename("papers/a.pdf", 7), "a.pdf");
        assert_eq!(download_filename("", 7), "document-7");
    }
}
