"use client";

import { AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { InsightsData } from "@/lib/insights-types";
import { Icon } from "../icons";
import { buildAi } from "./studio/ai";
import { buildStudioData, hasData } from "./studio/data";
import { PAGES, RESPONSIVE_BREAKPOINTS, defaultReport } from "./studio/report";
import { guardrailSealWidget } from "./studio/seal-widget";
import { mandateStudioTheme } from "./studio/theme";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

// Bumped when the default report changes (v2: the live/sample filter was removed; v3: the custom Guardrail seal was added),
// so a layout saved earlier does not hide the new widget.
const STORAGE_KEY = "mandate-insights-report-v3";

function loadSaved(): AgReportState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AgReportState) : null;
    return parsed && Array.isArray(parsed.pages) && parsed.pages.length ? parsed : null;
  } catch {
    return null; // storage blocked or corrupt: fall back to the built-in report
  }
}

const noSubscription = () => () => {};

// Studio's own widget menu, plus our custom Guardrail seal in a group of its own.
const widgets = (base: { menu: any[] }) =>
  createWidgets({ additionalTypes: [guardrailSealWidget], menu: [...base.menu, { label: "Mandate", widgetIds: ["guardrail-seal"] }] } as any);

type Props = {
  data: InsightsData;
  licenseKey?: string;
  aiEnabled: boolean;
};

export function InsightsClient(props: Props) {
  // Saved reports live in localStorage, which only exists in the browser.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return inBrowser ? <Insights {...props} /> : <Skeleton />;
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-[1360px] px-4 pt-6 sm:px-6" aria-busy="true" aria-label="Loading insights">
      <div className="skeleton h-12 w-72" />
      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
      <div className="skeleton mt-4 h-[380px]" />
    </div>
  );
}

function Insights({ data, licenseKey, aiEnabled }: Props) {
  const router = useRouter();
  const apiRef = useRef<AgStudioApi | null>(null);
  // Studio reads its theme tokens when it is created, so a theme flip remounts it on the same report.
  const carry = useRef<AgReportState | null>(null);
  const [themeKey, setThemeKey] = useState(0);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [state, setState] = useState<AgReportState | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const initialState = useMemo(() => carry.current ?? loadSaved() ?? defaultReport(), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const studioData = useMemo(() => buildStudioData(data), [data]);
  // The assistant's guardrail check needs to know which mandates the user has (it lists them as the tool's choices).
  const ai = useMemo(
    () => (aiEnabled ? buildAi(data.mandates.map((m) => ({ id: m.id, name: m.name, status: m.status.toLowerCase() }))) : undefined),
    [aiEnabled, data.mandates],
  );

  useEffect(() => {
    const obs = new MutationObserver(() => {
      carry.current = apiRef.current?.getState() ?? carry.current;
      setThemeKey((k) => k + 1);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const selected = (state ?? initialState).selectedPageId;

  const selectPage = (id: string) => {
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
  };

  const save = () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(api.getState()));
      setSavedAt(Date.now());
    } catch {
      /* storage blocked: edits stay for this session only */
    }
  };

  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    carry.current = null;
    const api = apiRef.current;
    if (api) {
      api.setState(defaultReport(selected));
      api.clearHistory();
    }
    setSavedAt(null);
  };

  const asOf = new Date(data.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const editing = mode === "edit";

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-8 pt-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5">The record, as analytics</p>
          <h1 className="title-2">Insights</h1>
          <p className="footnote mt-1 max-w-xl">
            {PAGES.find((p) => p.id === selected)?.blurb}. Updated {asOf}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label="Dashboard pages">
            {PAGES.map((p) => (
              <button key={p.id} aria-pressed={p.id === selected} onClick={() => selectPage(p.id)}>
                {p.title}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => router.refresh()}>
            Refresh
          </button>
          {editing && (
            <button className="btn btn-sm" onClick={reset}>
              Reset
            </button>
          )}
          <button
            className={`btn btn-sm ${editing ? "btn-primary" : ""}`}
            onClick={() => {
              if (editing) save();
              setMode(editing ? "view" : "edit");
            }}
          >
            {editing ? (
              "Save & done"
            ) : (
              <>
                <Icon name="sliders" size={14} />
                Edit dashboard
              </>
            )}
          </button>
        </div>
      </div>
      {savedAt && !editing && <p className="caption mb-2">Layout saved in this browser.</p>}

      <div style={{ height: "calc(100dvh - 215px)", minHeight: 560 }}>
        {hasData(data) ? (
          <AgStudioProvider key={themeKey} licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
            <AgStudio
              style={{ height: "100%", width: "100%" }}
              theme={mandateStudioTheme}
              data={studioData}
              widgets={widgets as any}
              responsiveLayoutBreakpoints={RESPONSIVE_BREAKPOINTS}
              ai={ai}
              initialState={initialState}
              mode={mode}
              // View mode is a clean canvas (the Data filter widget on the page does the filtering).
              // Declaring any layout drops Studio's defaults, so edit mode restates them.
              panels={{ view: { right: [] }, edit: { left: ai ? ["ai"] : [], right: ["filters", "edit", "data"] } }}
              onApiReady={(e) => {
                apiRef.current = e.api;
              }}
              onStudioReady={(e) => setState(e.api.getState())}
              onStateUpdated={(e) => setState(e.state)}
            />
          </AgStudioProvider>
        ) : (
          <div className="card pad">
            <h2 className="title-3">No activity yet</h2>
            <p className="footnote mt-1">Fund a mandate and run the agent on the Agent page, and the dashboard fills in.</p>
          </div>
        )}
      </div>
    </div>
  );
}
