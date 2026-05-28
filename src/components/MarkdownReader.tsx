import React, { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { codeToHtml } from "shiki";
import { invoke } from "@tauri-apps/api/core";
import { annotationService, Annotation } from "../db";
import { ask } from "@tauri-apps/plugin-dialog";
import "./MarkdownReader.css";
import { Link } from "lucide-react";

interface MarkdownReaderProps {
  documentId: number;
  filePath: string;
}

export const MarkdownReader: React.FC<MarkdownReaderProps> = ({ documentId, filePath }) => {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadAnnotations = async () => {
    try {
      const anns = await annotationService.getByDocument(documentId);
      setAnnotations(anns);
    } catch (err) {
      console.error("Failed to load annotations:", err);
    }
  };

  useEffect(() => {
    const loadFile = async () => {
      try {
        const data = await invoke<number[]>("read_file_from_library", { filePath });
        const fileData = new Uint8Array(data);
        const text = new TextDecoder().decode(fileData);
        setContent(text);
        loadAnnotations();
      } catch (err) {
        console.error("Failed to read markdown file:", err);
        setError("Failed to load document.");
      }
    };
    loadFile();
  }, [filePath, documentId]);

  const handleTextSelection = async () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString();
    if (text.length < 3) return; // Too short to highlight

    const confirmed = await ask(`Highlight "${text.substring(0, 20)}..."?`, {
      title: "Add Highlight",
      kind: "info"
    });
    if (confirmed) {
      try {
        await annotationService.create({
          document_id: documentId,
          annotation_type: "highlight",
          serialized_position: "text_match",
          content: text,
          color: "rgba(139, 92, 246, 0.3)" // Purple highlight
        });
        await loadAnnotations();
      } catch (err) {
        console.error("Failed to save annotation", err);
      }
    }
    selection.removeAllRanges();
  };

  // Very simple custom renderer for highlights and wikilinks
  const processContent = (raw: string) => {
    let processed = raw;
    
    // Fix missing blank line before tables
    // Matches a non-newline char, followed by \n, then a table header row, then the delimiter row
    processed = processed.replace(/([^\n])\n(\s*\|.*?\|\s*\n\s*\|[-:\s|]+\|\s*(\n|$))/g, '$1\n\n$2');
    
    // Fix empty lines between table rows
    // Matches a line ending with pipe, empty lines, and a line starting with pipe
    processed = processed.replace(/\|\s*\n\s*\n\s*\|/g, '|\n|');

    // Highlight existing annotations
    annotations.forEach(ann => {
      if (ann.content) {
        // Escaping regex chars
        const escapedContent = ann.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedContent})`, 'g');
        processed = processed.replace(regex, `<mark style="background-color: ${ann.color}">$1</mark>`);
      }
    });

    // WikiLinks [[Link]] -> a simple markdown link
    processed = processed.replace(/\[\[(.*?)\]\]/g, '<a href="#" class="wikilink" data-target="$1">#$1</a>');
    
    return processed;
  };

  if (error) {
    return <div className="text-red-500 p-4">{error}</div>;
  }

  return (
    <div className="markdown-reader-container relative" ref={containerRef} onMouseUp={handleTextSelection}>
      <div className="mb-4 text-xs text-muted flex items-center gap-1 border-b border-[var(--border-color)] pb-2">
        <Link size={12} />
        <span>Select text to highlight</span>
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
      <div className="mt-12 pt-8 border-t border-[var(--border-color)]">
        <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
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
