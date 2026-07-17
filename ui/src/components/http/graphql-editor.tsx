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

/**
 * Placeholder value for a parameter: an unambiguous `<name>` marker. At call
 * time the backend replaces `<name>` with that parameter's resolved value (and
 * drops the key if the parameter has no value), so the literal marker never
 * reaches the API. Using the param name (not a type token like "<string>")
 * keeps the mapping explicit and works for every type.
 */
function placeholderForParam(name: string): string {
    return `<${name}>`;
}

/** Build a JSON string of the variables shape derived from the parameters. */
export function variablesShapeFromParameters(
    parameters: ToolParameter[],
): string {
    const named = parameters.filter((p) => p.name.trim().length > 0);
    const shape: Record<string, unknown> = {};
    for (const param of named) {
        shape[param.name] = placeholderForParam(param.name);
    }
    return JSON.stringify(shape, null, 2);
}

interface GraphqlVariablesEditorProps {
    value: string;
    onValueChange: (value: string) => void;
    /** Parameters used to seed the editor when the value is empty. */
    parameters: ToolParameter[];
    rows?: number;
}

/**
 * Editable, syntax-highlighted JSON editor for the GraphQL `variables` object.
 * Seeded from the tool Parameters shape (e.g. {"identifier": "<string>"}) but
 * fully editable — whatever is entered is sent as the variables, with the
 * model-resolved parameter values merged in on top at call time.
 */
export function GraphqlVariablesEditor({
    value,
    onValueChange,
    parameters,
    rows = 4,
}: GraphqlVariablesEditorProps) {
    // Seed once from the parameter shape when the field is still empty, so the
    // user starts from a sensible default instead of a blank box.
    const seeded = value && value.trim().length > 0
        ? value
        : variablesShapeFromParameters(parameters);

    let isValidJson = true;
    if (seeded.trim().length > 0) {
        try {
            const parsed = JSON.parse(seeded);
            isValidJson =
                typeof parsed === "object" &&
                parsed !== null &&
                !Array.isArray(parsed);
        } catch {
            isValidJson = false;
        }
    }

    return (
        <div className="grid gap-2">
            <Label>Variables</Label>
            <Label className="text-xs text-muted-foreground">
                Editable JSON sent as the GraphQL <code>variables</code>.
                Pre-filled from the tool Parameters — edit to hardcode or shape
                values. Parameter values the model provides at call time are
                merged in on top for matching keys.
            </Label>
            <div
                className={`rounded-md border bg-background text-sm focus-within:ring-1 focus-within:ring-ring ${
                    isValidJson ? "border-input" : "border-destructive"
                }`}
                style={{ minHeight: `${rows * 1.5}rem` }}
            >
                <Editor
                    value={seeded}
                    onValueChange={onValueChange}
                    highlight={(code) =>
                        Prism.highlight(code, Prism.languages.json, "json")
                    }
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
            {!isValidJson && (
                <Label className="text-xs text-destructive">
                    Variables must be a valid JSON object.
                </Label>
            )}
        </div>
    );
}
