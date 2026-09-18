/** Cross-tab navigation payload: Insights click-throughs open the Journal
 * filtered to the entries behind a chart element (everything
 * links back to entries). */
export interface JournalFocus {
  label: string | null; // filter chip text, e.g. `theme: vendor conflict`
  dates: string[]; // entry dates to show; a single date auto-opens
}
