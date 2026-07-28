import { runSportQueryTurn, type SSEWriter } from '../controllers/sportquery'

// awslambda.streamifyResponse is a Lambda-runtime global injected by the
// Node 20 managed runtime when the function is invoked via a Function URL
// with invokeMode: RESPONSE_STREAM. It isn't part of any published types
// package, so it's declared minimally here.
declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: any,
      responseStream: NodeJS.WritableStream,
      context: unknown
    ) => Promise<void>
  ) => unknown
  HttpResponseStream: {
    from: (responseStream: NodeJS.WritableStream, metadata: unknown) => NodeJS.WritableStream
  }
}

// Same SSE framing/route contract as POST /api/sportquery/message, but served
// off a dedicated Function URL (RESPONSE_STREAM) instead of buffered API
// Gateway, since API Gateway buffers the full Lambda response and would turn
// this into one blob delivered at the end instead of incremental tokens.
export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const httpMethod = event.requestContext?.http?.method ?? 'POST'
  const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body) : {}
  const { sessionId, message } = body ?? {}

  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: sessionId && message ? 200 : 400,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })

  if (httpMethod !== 'POST' || !sessionId || !message) {
    stream.write(JSON.stringify({ success: false, error: 'sessionId and message required' }))
    stream.end()
    return
  }

  const send: SSEWriter = (evt, data) => {
    stream.write(`event: ${evt}\n`)
    stream.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    await runSportQueryTurn(sessionId, message, send)
  } finally {
    stream.end()
  }
})
