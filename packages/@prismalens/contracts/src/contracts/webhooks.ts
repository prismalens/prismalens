/**
 * Webhook route contracts
 */
import { oc } from '@orpc/contract'
import {
  PrometheusWebhookSchema,
  PrometheusWebhookResponseSchema,
  GenericWebhookSchema,
  GenericWebhookResponseSchema,
} from '../schemas/index.js'

export const webhooksContract = {
  /**
   * Receive Prometheus AlertManager webhook
   * POST /webhooks/prometheus
   */
  prometheus: oc
    .route({
      method: 'POST',
      path: '/webhooks/prometheus',
      summary: 'Receive Prometheus AlertManager webhook',
      tags: ['webhooks'],
    })
    .input(PrometheusWebhookSchema)
    .output(PrometheusWebhookResponseSchema),

  /**
   * Receive generic webhook
   * POST /webhooks/generic
   */
  generic: oc
    .route({
      method: 'POST',
      path: '/webhooks/generic',
      summary: 'Receive generic alert webhook',
      tags: ['webhooks'],
    })
    .input(GenericWebhookSchema)
    .output(GenericWebhookResponseSchema),
}
