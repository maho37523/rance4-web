// Data model for the walkthrough viewer.
//
// Content is plain data on purpose: it is easy to diff, easy to review against
// the source list at the end of each guide, and it carries no behaviour.

export type GuideBlock =
    | {kind: 'p'; text: string}
    | {kind: 'note'; text: string}
    | {kind: 'list'; items: string[]}
    | {kind: 'steps'; items: string[]}
    | {kind: 'table'; head: string[]; rows: string[][]};

export type GuideSection = {
    /** Section title shown in the navigation. */
    title: string;
    /** Short lead paragraph. */
    summary?: string;
    /**
     * Scenario page numbers this section covers.  When a game is running the
     * viewer highlights the section that owns the interpreter's current page.
     * Only filled in where the page is actually known.
     */
    pages?: number[];
    blocks: GuideBlock[];
};

export type GuideSource = {
    label: string;
    url: string;
};

export type Guide = {
    title: string;
    engine: string;
    /** One-paragraph description of the game and what the guide covers. */
    overview: string;
    sections: GuideSection[];
    sources: GuideSource[];
};
