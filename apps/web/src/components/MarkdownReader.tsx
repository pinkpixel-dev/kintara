import React, { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { codeToHtml } from "shiki";
import { annotationService, documentService, type Annotation } from "../api";
import "./MarkdownReader.css";
import { Link } from "lucide-react";

interface MarkdownReaderProps {
  documentId: number;
}

/** Read the current --highlight-color CSS variable from the document root. */
const getHighlightColor = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue('--highlight-color')
    .trim() || "rgba(139, 92, 246, 0.35)";

export const MarkdownReader: React.FC<MarkdownReaderProps> = ({ documentId }) => {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadAnnotations = useCallback(async () => {
    try {
      setAnnotations(await documentService.annotations(documentId));
    } catch (err) {
      console.error("Failed to load annotations:", err);
    }
  }, [documentId]);

  useEffect(() => {
    const loadFile = async () => {
      try {
        setContent(await documentService.text(documentId));
        loadAnnotations();
      } catch (err) {
        console.error("Failed to read markdown file:", err);
        setError("Failed to load document.");
      }
    };
    loadFile();
  }, [documentId]);

  /** On mouseup — immediately highlight selected text, no confirmation dialog. */
  const handleTextSelection = async () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();
    if (text.length < 3) return;

    const color = getHighlightColor();

    try {
      await annotationService.create({
        documentId,
        annotationType: "highlight",
        serializedPosition: "text_match",
        content: text,
        color,
      });
      await loadAnnotations();
    } catch (err) {
      console.error("Failed to save annotation", err);
    }
    selection.removeAllRanges();
  };

  /** Click on a <mark> element → remove that annotation. */
  const handleMarkClick = useCallback(async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== "MARK") return;

    const annotationId = Number(target.dataset.annotationId);
    if (!annotationId) return;

    e.stopPropagation();
    try {
      await annotationService.remove(annotationId);
      await loadAnnotations();
    } catch (err) {
      console.error("Failed to delete annotation", err);
    }
  }, [loadAnnotations]);

  // Attach click listener on the container to catch mark clicks via delegation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("click", handleMarkClick);
    return () => el.removeEventListener("click", handleMarkClick);
  }, [handleMarkClick]);

  const processContent = (raw: string) => {
    let processed = raw;

    // Fix missing blank line before tables
    processed = processed.replace(/([^\n])\n(\s*\|.*?\|\s*\n\s*\|[-:\s|]+\|\s*(\n|$))/g, '$1\n\n$2');
    // Fix empty lines between table rows
    processed = processed.replace(/\|\s*\n\s*\n\s*\|/g, '|\n|');

    // Wrap existing annotations in <mark> with data-annotation-id so click-to-remove works
    annotations.forEach(ann => {
      if (ann.content) {
        const escapedContent = ann.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedContent})`, 'g');
        processed = processed.replace(
          regex,
          `<mark data-annotation-id="${ann.id}" style="background-color: ${ann.color}; cursor: pointer; border-radius: 2px;" title="Click to remove highlight">$1</mark>`
        );
      }
    });

    // WikiLinks [[Link]] → a simple markdown link
    processed = processed.replace(/\[\[(.*?)\]\]/g, '<a href="#" class="wikilink" data-target="$1">#$1</a>');

    return processed;
  };

  if (error) {
    return <div className="reader-error">{error}</div>;
  }

  return (
    <div className="markdown-reader-container relative" ref={containerRef} onMouseUp={handleTextSelection}>
      <div className="markdown-meta">
        <Link size={12} />
        <span>Select text to highlight · Click a highlight to remove it</span>
      </div>

      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const [highlightedCode, setHighlightedCode] = useState<string | null>(null);

            useEffect(() => {
              if (!inline && match) {
                codeToHtml(String(children).replace(/\n$/, ""), {
                  lang: match[1],
                  theme: "github-dark",
                }).then(setHighlightedCode);
              }
            }, [match, children, inline]);

            if (!inline && match) {
              return highlightedCode ? (
                <div dangerouslySetInnerHTML={{ __html: highlightedCode }} />
              ) : (
                <pre className={className} {...props}>
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code className={`${className} inline-code`} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {processContent(content)}
      </ReactMarkdown>

      {/* Render Backlinks panel below content */}
      <div className="markdown-backlinks">
        <h3 className="markdown-backlinks-title">
          <Link size={18} className="text-[var(--accent)]" />
          Linked Mentions
        </h3>
        <p className="text-sm text-secondary italic">
          (Backlinks engine parses SQLite for documents containing `[[this_file]]`)
        </p>
      </div>
    </div>
  );
};
