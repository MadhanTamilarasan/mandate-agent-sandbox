// AG Studio theme for the Insights dashboard. Every value points at a design token from
// app/globals.css, the same variables the rest of the app uses, so Studio's widgets, grids and
// charts read as part of the ledger rather than an embedded component.

import { studioTheme } from "ag-studio";

const token = (name: string) => `var(--${name})`;
const line = (color: string, width = 1) => ({ width, color: token(color) });

const palette = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, token(`chart-${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, token(`chart-${i + 1}`)],
  ]).flat(),
);

export const mandateStudioTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: token("font"),
  fontSize: 14,
  textColor: token("text"),
  foregroundColor: token("text"),
  subtleTextColor: token("muted"),
  backgroundColor: token("surface"),
  borderColor: token("line"),
  accentColor: token("accent"),
  iconColor: token("muted"),
  rowHoverColor: token("fill-soft"),

  // No frame: the canvas is the page itself.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("bg"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("bg"),
  studioCanvasPadding: 4,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token("font"),

  // Widgets are ledger sheets: paper surface, hairline border, a small radius.
  studioWidgetBackgroundColor: token("surface"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 6,
  studioWidgetPadding: 14,
  studioWidgetTitleFontFamily: token("display"),
  studioWidgetTitleFontSize: 18,
  studioWidgetTitleFontWeight: 500,
  studioWidgetTitleTextColor: token("text"),
  studioWidgetSubtitleFontFamily: token("font"),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token("muted"),
  studioWidgetCaptionFontFamily: token("font"),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token("muted"),
  studioWidgetResizeBorderColor: token("accent"),

  // Edit-mode panels.
  studioPanelContainerBackgroundColor: token("surface"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("line"),
  studioPanelDividerActiveColor: token("accent"),
  studioPanelSectionBorderColor: token("line"),
  studioPanelHeaderFontFamily: token("font"),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token("fill"),
  studioPanelChevronButtonHoverColor: token("text"),
  studioToggleButtonActiveBackgroundColor: token("fill"),
  studioToggleButtonActiveBorderColor: token("accent"),
  studioToggleButtonActiveColor: token("accent"),

  // Grid widgets: quiet headers, hairline rows.
  gridFontFamily: token("font"),
  gridFontSize: 13,
  gridCellTextColor: token("text"),
  gridHeaderBackgroundColor: token("surface"),
  gridHeaderTextColor: token("muted"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 11,
  gridRowHeight: 36,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line-strong"),
  gridPinnedRowBorder: line("line-strong"),
  gridRowHoverColor: token("fill-soft"),
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: token("font"),
  chartTextColor: token("text"),
  chartSubtleTextColor: token("muted"),
  chartAxisLineColor: token("line-strong"),
  chartGridLineColor: token("line"),
  ...palette,
});
