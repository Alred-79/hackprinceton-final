export interface ArchitectTemplate {
  id: string;
  title: string;
  prompt: string;
}

export const ARCHITECT_TEMPLATES: readonly ArchitectTemplate[] = [
  {
    id: "market-intel",
    title: "Live Competitor Intel Feed",
    prompt:
      "My company [YOUR_COMPANY] sells [YOUR_PRODUCT]. Every morning: stream the latest news about our top 3 competitors from the web, hit their pricing APIs to detect changes, cross-reference with our Postgres CRM for deals we lost last month, run sentiment analysis on anything flagged, and push a [bullet-point Slack digest / full PDF brief] before 9am. If a competitor drops pricing by more than 10%, page the sales lead immediately and skip the digest.",
  },
  {
    id: "bug-triage",
    title: "Sentry → Incident Report Bot",
    prompt:
      "I'm an engineer at [YOUR_COMPANY]. When a Sentry alert fires for our [YOUR_SERVICE] service: fetch the stack trace, search our GitHub repo for the relevant files, query Postgres for impacted users in the last hour, check our internal Confluence knowledge base for prior incidents, then draft a [Slack war-room message / full PagerDuty incident report] with a root-cause hypothesis and a suggested fix. Only page on-call if affected users > [YOUR_THRESHOLD].",
  },
  {
    id: "content-repurposer",
    title: "Publish-Once, Repurpose Everywhere",
    prompt:
      "We publish [research papers / podcast transcripts / YouTube videos] about [YOUR_TOPIC]. When a new piece drops: search the web for trending discussions on this topic, pull our past content from the knowledge base for brand consistency, write [3 tweets + a LinkedIn post / a newsletter section / all of the above], fact-check any statistics against live sources, run it through a brand voice evaluator, and only publish if confidence score > 85%. Flag anything that contradicts what we said last quarter.",
  },
  {
    id: "order-pipeline",
    title: "Kafka Order Processing Pipeline",
    prompt:
      "We run an e-commerce platform for [YOUR_INDUSTRY]. Orders stream from Kafka at ~[YOUR_VOLUME] per minute. For each order: validate payment via our billing API, check real-time inventory in our warehouse DB, route [orders over $500 / all orders] through fraud scoring, apply [loyalty tier / promo code / geo-based] discount logic, execute the inventory reservation as a DB transaction, write the confirmed order back, and emit a fulfillment event — all under 2 seconds. Dead-letter anything that fails validation.",
  },
  {
    id: "due-diligence",
    title: "VC / BD Deal Research Bot",
    prompt:
      "I work in [VC / BD / product strategy] at [YOUR_FIRM]. Given a company name: search the web for recent funding rounds and press, scrape their job board to infer engineering priorities, pull SEC filings if they're public, check our internal deal notes database for prior contact, run a SWOT synthesis with citations, iterate the report once if web coverage feels thin, and output a [1-page tearsheet / full investment memo] — [include / exclude] a comparable comps table. Flag anything that looks like they're pivoting.",
  },
] as const;

