import type { MessageBatch } from './quality-types'

/**
 * 审计扫描用的消息批次（纯前端样例）。
 * 每批是一次扫描时刻的「消息全集」，轮次记录引用 batchId，保证事后能复现比对结果。
 */
export const SEED_MESSAGE_BATCHES: MessageBatch[] = [
  {
    batchId: 'MSG-20261112',
    eventCode: 'EVEN-0002',
    windowStart: '2026-11-12T00:00:00+08:00',
    windowEnd: '2026-11-13T00:00:00+08:00',
    collectedAt: '2026-11-13T01:00:00+08:00',
    label: '2026-11-12 全量消息（基线扫描批次）',
    messages: [
      {
        messageId: 'MSG-20261112-0001',
        receivedAt: '2026-11-12T08:12:00+08:00',
        sourcePage: '信息流首页',
        samplingRate: '25%',
        params: {
          source: 'feed',
          platform: 'web',
          content_id: 'feed-1001',
          is_new_user: 'false',
          ab_bucket: 'bucket-a',
        },
      },
      {
        messageId: 'MSG-20261112-0002',
        receivedAt: '2026-11-12T09:37:00+08:00',
        sourcePage: '信息流首页',
        samplingRate: '25%',
        params: {
          source: 'feed',
          platform: 'ios',
          content_id: 'feed-1002',
          is_new_user: 'true',
          ab_bucket: 'bucket-a',
        },
      },
      {
        messageId: 'MSG-20261112-0003',
        receivedAt: '2026-11-12T14:05:00+08:00',
        sourcePage: '信息流频道页',
        samplingRate: '25%',
        params: {
          source: 'feed',
          content_id: 'feed-1003',
          is_new_user: 'false',
          ab_bucket: 'bucket-b',
        },
      },
      {
        messageId: 'MSG-20261112-0004',
        receivedAt: '2026-11-12T21:48:00+08:00',
        sourcePage: '信息流首页',
        samplingRate: '25%',
        params: {
          source: 'push',
          platform: 'web',
          content_id: 'feed-1004',
          is_new_user: 'false',
          ab_bucket: 'bucket-a',
        },
      },
    ],
  },
  {
    batchId: 'MSG-20261113',
    eventCode: 'EVEN-0002',
    windowStart: '2026-11-13T00:00:00+08:00',
    windowEnd: '2026-11-14T00:00:00+08:00',
    collectedAt: '2026-11-14T01:00:00+08:00',
    label: '2026-11-13 全量消息（事件改版后首个批次）',
    messages: [
      {
        messageId: 'MSG-20261113-0001',
        receivedAt: '2026-11-13T10:20:00+08:00',
        sourcePage: '信息流首页',
        samplingRate: '25%',
        params: {
          source: 'organic',
          platform: 'web',
          content_id: 'feed-2001',
          timestamp: '1763000400000',
          ab_bucket: 'bucket-b',
        },
      },
      {
        messageId: 'MSG-20261113-0002',
        receivedAt: '2026-11-13T11:02:00+08:00',
        sourcePage: '信息流首页',
        samplingRate: '25%',
        params: {
          source: 'feed',
          platform: 'web',
          content_id: 'feed-2002',
          timestamp: '1763002920000',
          ab_bucket: 'bucket-a',
        },
      },
      {
        messageId: 'MSG-20261113-0003',
        receivedAt: '2026-11-13T16:41:00+08:00',
        sourcePage: '信息流频道页',
        samplingRate: '25%',
        params: {
          source: 'feed',
          platform: 'web',
          timestamp: '1763023260000',
          is_new_user: 'false',
          ab_bucket: 'bucket-c',
        },
      },
      {
        messageId: 'MSG-20261113-0004',
        receivedAt: '2026-11-13T19:55:00+08:00',
        sourcePage: '信息流首页',
        samplingRate: '25%',
        params: {
          source: 'feed',
          platform: 'web',
          content_id: 'feed-2004',
          timestamp: '1763034900000',
          is_new_user: 'false',
          ab_bucket: 'bucket-a',
        },
      },
    ],
  },
  {
    batchId: 'MSG-20261114',
    eventCode: 'EVEN-0002',
    windowStart: '2026-11-14T00:00:00+08:00',
    windowEnd: '2026-11-15T00:00:00+08:00',
    collectedAt: '2026-11-15T01:00:00+08:00',
    label: '2026-11-14 全量消息（采样比例被调回 10%）',
    messages: [
      {
        messageId: 'MSG-20261114-0001',
        receivedAt: '2026-11-14T09:10:00+08:00',
        sourcePage: '信息流首页',
        samplingRate: '10%',
        params: {
          source: 'feed',
          platform: 'web',
          content_id: 'feed-3001',
          timestamp: '1763082600000',
          is_new_user: 'false',
          ab_bucket: 'bucket-a',
        },
      },
      {
        messageId: 'MSG-20261114-0002',
        receivedAt: '2026-11-14T13:25:00+08:00',
        sourcePage: '信息流频道页',
        samplingRate: '10%',
        params: {
          source: 'feed',
          platform: 'web',
          content_id: 'feed-3002',
          timestamp: '1763097900000',
          is_new_user: 'false',
          ab_bucket: 'bucket-b',
        },
      },
    ],
  },
]
