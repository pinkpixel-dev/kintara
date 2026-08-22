import type { AiSearchInterpretation, DocumentQuery } from "../api";
import type { ActiveView } from "./empty-reason";

/** The scope hint sent with a request, taken from the view being searched. */
export function scopeFor(view: ActiveView): { libraryId?: number; collectionId?: number } {
  if (view.type === "library" && view.id) return { libraryId: view.id };
  if (view.type === "collection" && view.id) return { collectionId: view.id };
  return {};
}

/**
 * The narrowest view an interpretation can be shown in.
 *
 * A collection already implies its library, and a tag or a sort order is not a
 * view at all — those come back from `extraFiltersFor` instead.
 */
export function viewForInterpretation(result: AiSearchInterpretation): ActiveView {
  if (result.collectionId) return { type: "collection", id: result.collectionId };
  if (result.libraryId) return { type: "library", id: result.libraryId };
  if (result.favorite) return { type: "favorites" };
  return { type: "all" };
}

/**
 * The filters no sidebar view can express, layered on top of one that can.
 *
 * Favourites appears in both places on purpose: it is a view when it is the
 * only scope, and a filter when the request also named a library.
 */
export function extraFiltersFor(result: AiSearchInterpretation): DocumentQuery {
  const filters: DocumentQuery = {};
  if (result.tagId) filters.tagId = result.tagId;
  if (result.favorite) filters.favorite = true;
  if (result.sort !== "recent") filters.sort = result.sort;
  return filters;
}

const SORT_LABELS: Record<AiSearchInterpretation["sort"], string> = {
  recent: "recently changed first",
  added: "newest first",
  title: "by title",
  author: "by author",
  year: "by year",
};

/**
 * One label per filter the rewrite actually set.
 *
 * Named rather than summarised: a reader who asked for one library and got
 * another has to see which one before they can tell the answer is wrong.
 */
export function describeInterpretation(result: AiSearchInterpretation): string[] {
  const described: string[] = [];
  if (result.terms) described.push(`“${result.terms}”`);
  if (result.collectionName) described.push(`in ${result.collectionName}`);
  else if (result.libraryName) described.push(`in ${result.libraryName}`);
  else described.push("everywhere");
  if (result.tagName) described.push(`tagged ${result.tagName}`);
  if (result.favorite) described.push("Favorites");
  if (result.sort !== "recent") described.push(SORT_LABELS[result.sort]);
  return described;
}
