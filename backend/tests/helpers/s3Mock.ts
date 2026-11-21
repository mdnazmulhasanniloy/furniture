import { vi } from 'vitest';

/**
 * In-memory stand-in for `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (T-008). Tests wire it with
 * `vi.mock(..., async () => (await import('../helpers/s3Mock.js')).clientS3Module)`; nothing touches a network.
 */
export interface Call {
  type: string;
  input: Record<string, unknown>;
}
export const SIGNATURE = 'SIGNATURE-DO-NOT-LOG';

export const s3State = {
  calls: [] as Call[],
  /** objects `HeadObject` can see, by key */
  objects: new Map<string, { ContentType?: string; ContentLength?: number }>(),
  deleted: [] as string[],
  failDelete: new Set<string>(),
  headError: undefined as Error | undefined,
  clientConfigs: [] as unknown[],
};

export function resetS3() {
  s3State.calls = [];
  s3State.objects.clear();
  s3State.deleted = [];
  s3State.failDelete.clear();
  s3State.headError = undefined;
  presignerModule.getSignedUrl.mockClear();
}

const notFound = () =>
  Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });

class Cmd {
  constructor(public input: Record<string, unknown>) {}
}
class PutObjectCommand extends Cmd {}
class HeadObjectCommand extends Cmd {}
class DeleteObjectCommand extends Cmd {}

class S3Client {
  constructor(config: unknown) {
    s3State.clientConfigs.push(config);
  }
  async send(cmd: Cmd) {
    s3State.calls.push({ type: cmd.constructor.name, input: cmd.input });
    const key = String(cmd.input.Key);
    if (cmd instanceof HeadObjectCommand) {
      if (s3State.headError) throw s3State.headError;
      const o = s3State.objects.get(key);
      if (!o) throw notFound();
      return o;
    }
    if (cmd instanceof DeleteObjectCommand) {
      if (s3State.failDelete.has(key)) throw new Error('R2 unavailable');
      s3State.deleted.push(key);
      s3State.objects.delete(key);
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name}`);
  }
}

export const clientS3Module = {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
};

export const presignerModule = {
  getSignedUrl: vi.fn(async (_client: unknown, cmd: Cmd, _opts: { expiresIn: number }) => {
    return `https://test-bucket.test-account.r2.cloudflarestorage.com/${String(cmd.input.Key)}?X-Amz-Signature=${SIGNATURE}`;
  }),
};

export const callsOf = (type: string) => s3State.calls.filter((c) => c.type === type);
