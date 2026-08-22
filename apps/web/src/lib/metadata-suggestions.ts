import type { Document, MetadataSuggestionCandidate } from "../api";

export type MetadataSuggestionField = keyof Pick<
  Document,
  "title" | "author" | "summary" | "keywords" | "doi" | "isbn" | "year"
>;

export interface MetadataSuggestionDescriptor {
  field: MetadataSuggestionField;
  label: string;
}

export const METADATA_SUGGESTION_FIELDS: readonly MetadataSuggestionDescriptor[] = [
  { field: "title", label: "Title" },
  { field: "author", label: "Author" },
  { field: "summary", label: "Summary" },
  { field: "keywords", label: "Keywords" },
  { field: "doi", label: "DOI" },
  { field: "isbn", label: "ISBN" },
  { field: "year", label: "Publication year" },
];

export function reviewableSuggestions(
  document: Document,
  candidate: MetadataSuggestionCandidate,
): MetadataSuggestionDescriptor[] {
  return METADATA_SUGGESTION_FIELDS.filter(({ field }) => {
    const suggestion = candidate[field];
    return hasValue(suggestion) && normalized(suggestion) !== normalized(document[field]);
  });
}

export function defaultSelectedFields(
  document: Document,
  candidate: MetadataSuggestionCandidate,
): Set<MetadataSuggestionField> {
  return new Set(
    reviewableSuggestions(document, candidate)
      .filter(({ field }) => !hasValue(document[field]))
      .map(({ field }) => field),
  );
}

export function missingSuggestionLabels(candidate: MetadataSuggestionCandidate): string[] {
  return METADATA_SUGGESTION_FIELDS
    .filter(({ field }) => !hasValue(candidate[field]))
    .map(({ label }) => label.toLocaleLowerCase());
}

export function applySelectedMetadata(
  document: Document,
  candidate: MetadataSuggestionCandidate,
  selected: ReadonlySet<MetadataSuggestionField>,
): Document {
  const next = { ...document };
  for (const { field } of METADATA_SUGGESTION_FIELDS) {
    if (!selected.has(field) || !hasValue(candidate[field])) continue;
    assign(next, field, candidate[field]);
  }
  return next;
}

export function displayMetadataValue(value: string | number | null): string {
  return hasValue(value) ? String(value).trim() : "Blank";
}

function hasValue(value: string | number | null): value is string | number {
  return value !== null && (typeof value === "number" || value.trim().length > 0);
}

function normalized(value: string | number | null): string {
  return hasValue(value) ? String(value).trim() : "";
}

function assign(
  document: Document,
  field: MetadataSuggestionField,
  value: string | number | null,
) {
  switch (field) {
    case "year":
      document.year = typeof value === "number" ? value : null;
      break;
    case "title":
      if (typeof value === "string") document.title = value.trim();
      break;
    case "author":
      document.author = typeof value === "string" ? value.trim() : null;
      break;
    case "summary":
      document.summary = typeof value === "string" ? value.trim() : null;
      break;
    case "keywords":
      document.keywords = typeof value === "string" ? value.trim() : null;
      break;
    case "doi":
      document.doi = typeof value === "string" ? value.trim() : null;
      break;
    case "isbn":
      document.isbn = typeof value === "string" ? value.trim() : null;
      break;
  }
}
