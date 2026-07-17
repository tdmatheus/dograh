"use client";

// Import Prism as a namespace FIRST and expose it as a global so the language
// component files (which reference `Prism.languages...` at module-eval time)
// find it. Importing the components before this global is set throws
// "Prism is not defined" at runtime. Order matters here.
import Prism from "prismjs";

if (typeof globalThis !== "undefined") {
    (globalThis as unknown as { Prism: typeof Prism }).Prism = Prism;
}

import "prismjs/components/prism-clike";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-json";
import "prismjs/themes/prism.css";

import { useMemo } from "react";
import Editor from "react-simple-code-editor";

import { Label } from "@/components/ui/label";

import type { ToolParameter } from "./parameter-editor";

interface GraphqlQueryEditorProps {
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    /** Approximate number of visible rows, used to set a min height. */
    rows?: number;
}

/**
 * Syntax-highlighted, controlled GraphQL query editor.
 * Drop-in replacement for the plain <Textarea> that was used for the
 * GraphQL Query field.
 */
export function GraphqlQueryEditor({
    value,
    onValueChange,
    placeholder,
    rows = 8,
}: GraphqlQueryEditorProps) {
    return (
        <div
            className="rounded-md border border-input bg-background text-sm focus-within:ring-1 focus-within:ring-ring"
            style={{ minHeight: `${rows * 1.5}rem` }}
        >
            <Editor
                value={value}
                onValueChange={onValueChange}
                highlight={(code) =>
                    Prism.highlight(code, Prism.languages.graphql, "graphql")
                }
                placeholder={placeholder}
                padding={12}
                textareaClassName="focus:outline-none"
                className="font-mono text-sm"
                style={{
                    fontFamily:
                        "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                    minHeight: `${rows * 1.5}rem`,
                }}
            />
        </div>
    );
}

/** Placeholder value for each ToolParameter type, used to render the shape. */
function placeholderForType(type: ToolParameter["type"]): unknown {
    switch (type) {
        case "string":
            return "<string>";
        case "number":
            return 0;
        case "boolean":
            return false;
        case "object":
            return {};
        case "array":
            return [];
        default:
            return "<string>";
    }
}

interface GraphqlVariablesPreviewProps {
    parameters: ToolParameter[];
}

/**
 * Read-only, syntax-highlighted JSON preview of the GraphQL `variables`
 * shape derived from the current tool Parameters. Purely visual — nothing
 * is persisted from here.
 */
export function GraphqlVariablesPreview({
    parameters,
}: GraphqlVariablesPreviewProps) {
    const { json, hasParameters } = useMemo(() => {
        const named = parameters.filter((p) => p.name.trim().length > 0);
        const shape: Record<string, unknown> = {};
        for (const param of named) {
            shape[param.name] = placeholderForType(param.type);
        }
        return {
            json: JSON.stringify(shape, null, 2),
            hasParameters: named.length > 0,
        };
    }, [parameters]);

    const highlighted = useMemo(
        () => Prism.highlight(json, Prism.languages.json, "json"),
        [json],
    );

    return (
        <div className="grid gap-2">
            <Label>Variables</Label>
            <div className="rounded-md border border-input bg-muted/40 overflow-x-auto">
                <pre className="p-3 m-0 text-sm">
                    <code
                        className="font-mono language-json"
                        // Prism-highlighted, read-only, derived content only.
                        dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                </pre>
            </div>
            <Label className="text-xs text-muted-foreground">
                These variables are filled from the tool Parameters at call
                time.
            </Label>
            {!hasParameters && (
                <Label className="text-xs text-muted-foreground">
                    No parameters defined yet. Add them in the Parameters tab to
                    see them here.
                </Label>
            )}
        </div>
    );
}
