mod common;

use common::{TestApp, body_json};

const SAMPLE: &[u8] = b"pagination sample";

#[tokio::test]
async fn paging_has_a_stable_order_when_sort_values_match() {
    let app = TestApp::new().await;
    let mut expected = Vec::new();
    for i in 0..5 {
        expected.push(app.add_document(&format!("doc{i}.pdf"), SAMPLE).await);
    }
    expected.reverse();

    sqlx::query(
        "UPDATE documents
         SET title = 'same', author = 'same', year = 2026,
             created_at = '2026-08-22 12:00:00', modified_at = '2026-08-22 12:00:00'",
    )
    .execute(&app.db)
    .await
    .unwrap();

    for sort in ["recent", "added", "title", "author", "year"] {
        let mut actual = Vec::new();
        for offset in [0, 2, 4] {
            let json = body_json(
                app.get(&format!(
                    "/api/documents?sort={sort}&limit=2&offset={offset}"
                ))
                .await,
            )
            .await;
            actual.extend(
                json["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| item["id"].as_i64().unwrap()),
            );
        }
        assert_eq!(
            actual, expected,
            "{sort} paging must not skip or repeat ties"
        );
    }
}
