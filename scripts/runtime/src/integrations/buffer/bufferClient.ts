import type { BufferMetric } from "../../analytics/normalizeMetrics.ts";

export type BufferPostWithMetrics = {
  id: string;
  text: string | null;
  channelId: string | null;
  dueAt: string | null;
  metrics: BufferMetric[];
  metricsUpdatedAt: string | null;
};

export type GetSentPostsParams = {
  organizationId: string;
  channelIds?: string[];
  after?: string | null;
  limit?: number;
};

export type SentPostsPage = {
  posts: BufferPostWithMetrics[];
  endCursor: string | null;
  hasNextPage: boolean;
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string; path?: unknown; extensions?: unknown }>;
};

const GET_POST_METRICS = `query GetPostMetrics($id: ID!) {
  post(input: { id: $id }) {
    id
    text
    channelId
    dueAt
    metrics {
      type
      name
      value
      unit
    }
    metricsUpdatedAt
  }
}`;

const GET_SENT_POSTS_WITH_METRICS = `query GetSentPostsWithMetrics($organizationId: ID!, $channelIds: [ID!], $after: String) {
  posts(
    first: 50
    after: $after
    input: {
      organizationId: $organizationId
      filter: {
        status: [sent]
        channelIds: $channelIds
      }
    }
  ) {
    edges {
      node {
        id
        text
        channelId
        dueAt
        metrics {
          type
          name
          value
          unit
        }
        metricsUpdatedAt
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}`;

export class BufferClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly maxAttempts: number;

  constructor(options: { apiKey?: string; endpoint?: string; maxAttempts?: number } = {}) {
    this.apiKey = options.apiKey ?? String(process.env.BUFFER_API_KEY ?? "");
    this.endpoint = options.endpoint
      ?? String(process.env.BUFFER_GRAPHQL_ENDPOINT ?? process.env.BUFFER_API_URL ?? "https://api.buffer.com");
    this.maxAttempts = options.maxAttempts ?? 4;
  }

  async graphqlRequest<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error("BUFFER_API_KEY is required for Buffer GraphQL requests.");
    }
    if (!this.endpoint) {
      throw new Error("BUFFER_GRAPHQL_ENDPOINT is required for Buffer GraphQL requests.");
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "authorization": `Bearer ${this.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ query, variables })
        });

        const body = await parseJson(response);
        if (response.ok && !body.errors) {
          return body.data as T;
        }

        const message = body.errors?.length
          ? body.errors.map((error) => error.message ?? "Unknown GraphQL error").join("; ")
          : `HTTP ${response.status}`;
        const error = new Error(`Buffer GraphQL request failed: ${message}`);
        if (!isRetryable(response.status) || attempt === this.maxAttempts) throw error;
        lastError = error;
        await wait(backoffMs(attempt, response.headers.get("retry-after")));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Buffer GraphQL request failed.");
        if (attempt === this.maxAttempts) break;
        await wait(backoffMs(attempt));
      }
    }

    throw lastError ?? new Error("Buffer GraphQL request failed.");
  }

  async getPostMetrics(bufferPostId: string): Promise<BufferPostWithMetrics> {
    const data = await this.graphqlRequest<{ post?: unknown }>(GET_POST_METRICS, { id: bufferPostId });
    const post = toBufferPost(data.post);
    if (!post.id) throw new Error(`Buffer post not found or missing id: ${bufferPostId}`);
    return post;
  }

  async getSentPostsWithMetrics(params: GetSentPostsParams): Promise<SentPostsPage> {
    const data = await this.graphqlRequest<{ posts?: unknown }>(GET_SENT_POSTS_WITH_METRICS, {
      organizationId: params.organizationId,
      channelIds: params.channelIds && params.channelIds.length > 0 ? params.channelIds : null,
      after: params.after ?? null
    });
    return toSentPostsPage(data.posts);
  }
}

function toBufferPost(value: unknown): BufferPostWithMetrics {
  const record = asRecord(value);
  return {
    id: String(record.id ?? ""),
    text: nullableString(record.text),
    channelId: nullableString(record.channelId),
    dueAt: nullableString(record.dueAt),
    metrics: Array.isArray(record.metrics) ? record.metrics.map(toMetric) : [],
    metricsUpdatedAt: nullableString(record.metricsUpdatedAt)
  };
}

function toSentPostsPage(value: unknown): SentPostsPage {
  const record = asRecord(value);
  const edges = Array.isArray(record.edges) ? record.edges : [];
  const pageInfo = asRecord(record.pageInfo);
  return {
    posts: edges.map((edge) => toBufferPost(asRecord(edge).node)).filter((post) => post.id),
    endCursor: nullableString(pageInfo.endCursor),
    hasNextPage: pageInfo.hasNextPage === true
  };
}

function toMetric(value: unknown): BufferMetric {
  const record = asRecord(value);
  return {
    type: nullableString(record.type),
    name: nullableString(record.name),
    value: typeof record.value === "number" || typeof record.value === "string" ? record.value : null,
    unit: nullableString(record.unit)
  };
}

async function parseJson(response: Response): Promise<GraphqlResponse<unknown>> {
  try {
    return await response.json() as GraphqlResponse<unknown>;
  } catch {
    return {};
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function backoffMs(attempt: number, retryAfter: string | null = null): number {
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  return Math.min(1000 * (2 ** (attempt - 1)), 8000) + Math.floor(Math.random() * 150);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
