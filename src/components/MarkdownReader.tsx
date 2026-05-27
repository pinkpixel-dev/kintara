import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { codeToHtml } from "shiki";
import { readFile } from "@tauri-apps/plugin-fs";
import "./MarkdownReader.css";

interface MarkdownReaderProps {
  filePath: string;
}

export const MarkdownReader: React.FC<MarkdownReaderProps> = ({ filePath }) => {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadFile = async () => {
      try {
        const fileData = await readFile(filePath);
        // Convert Uint8Array to string
        const text = new TextDecoder().decode(fileData);
        setContent(text);
      } catch (err) {
        console.error("Failed to read markdown file:", err);
        setError("Failed to load document.");
      }
    };
    loadFile();
  }, [filePath]);

  if (error) {
    return <div className="text-red-500 p-4">{error}</div>;
  }

  return (
    <div className="markdown-reader-container">
      <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const [highlightedCode, setHighlightedCode] = useState<string | null>(null);

            useEffect(() => {
              if (!inline && match) {
                codeToHtml(String(children).replace(/\n$/, ""), {
                  lang: match[1],
                  theme: "github-dark", // can be changed based on theme
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
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
