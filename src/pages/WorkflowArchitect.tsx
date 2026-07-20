import { useReducer } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Sparkles, Wand2 } from "lucide-react";
import WorkflowResult from "@/components/architect/WorkflowResult";
import { architectReducer, createArchitectState } from "@/features/architect/architectReducer";
import { ARCHITECT_TEMPLATES } from "@/features/architect/templates";

export default function WorkflowArchitect() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(architectReducer, undefined, createArchitectState);

  return (
    <div className="min-h-screen bg-background architect-page">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/app")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
          <div className="h-4 w-px bg-border" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" aria-hidden="true" />
            <h1 className="text-sm font-semibold text-foreground">Workflow Architect</h1>
          </div>
          <span className="text-xs text-muted-foreground">Describe a task. Build a local workflow draft.</span>
        </div>
      </header>

      <main className="architect-page-shell px-4 sm:px-6 py-6 sm:py-8">
        <section className="architect-prompt-layout" aria-labelledby="architect-prompt-title">
          <div className="architect-prompt-card">
            <label id="architect-prompt-title" htmlFor="architect-description">Describe your task</label>
            <textarea
              id="architect-description"
              value={state.prompt}
              onChange={(event) => dispatch({ type: "SET_PROMPT", prompt: event.target.value })}
              maxLength={8_000}
              placeholder="Build an agent that streams from Kafka, queries Postgres, hits 3 external APIs, and only pages someone if confidence < 80%..."
            />
            <div className="architect-prompt-footer">
              <span>Replace <code>[YOUR_X]</code> in templates with your details</span>
              <button
                type="button"
                onClick={() => dispatch({ type: "REQUEST_COMPILE" })}
                disabled={!state.prompt.trim()}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Decompose
              </button>
            </div>
            <p className="architect-character-count">{state.prompt.length.toLocaleString()} / 8,000 characters</p>
          </div>

          <div className="architect-template-card">
            <h2>Templates</h2>
            <div>
              {ARCHITECT_TEMPLATES.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  onClick={() => dispatch({ type: "SET_PROMPT", prompt: template.prompt })}
                >
                  <span>{template.title}</span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </section>

        {!state.graph ? (
          <section className="architect-initial-state" aria-label="Workflow draft guidance">
            <Wand2 aria-hidden="true" />
            <p>Describe a task or pick a template</p>
            <span>We&apos;ll map recognized steps, disclose ambiguity, and let you edit the draft.</span>
          </section>
        ) : (
          <WorkflowResult state={state} dispatch={dispatch} />
        )}
      </main>

      {state.replacementPending && (
        <div className="architect-dialog-backdrop" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="replace-draft-title" aria-describedby="replace-draft-description" className="architect-dialog">
            <h2 id="replace-draft-title">Replace edited draft?</h2>
            <p id="replace-draft-description">Rebuilding from the description will permanently discard your graph edits and preview state.</p>
            <div>
              <button type="button" onClick={() => dispatch({ type: "CANCEL_REPLACE" })} autoFocus>Keep my edits</button>
              <button type="button" className="architect-danger-button" onClick={() => dispatch({ type: "CONFIRM_REPLACE" })}>Discard edits and rebuild</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
