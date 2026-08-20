import {
  DEFAULT_MASCOT_TRAIT_KEYS,
  DEFAULT_MASCOT_V2_KEYS,
  PfpService,
} from './pfp.service';

describe('PfpService mascot assignment', () => {
  const originalVersion = process.env.MASCOT_CATALOG_VERSION;
  const originalLegacyCatalog = process.env.MASCOT_TRAIT_KEYS;
  const originalV2Catalog = process.env.MASCOT_PFP_KEYS;
  const originalV2Prefix = process.env.MASCOT_V2_ASSET_PREFIX;

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnvironment('MASCOT_CATALOG_VERSION', originalVersion);
    restoreEnvironment('MASCOT_TRAIT_KEYS', originalLegacyCatalog);
    restoreEnvironment('MASCOT_PFP_KEYS', originalV2Catalog);
    restoreEnvironment('MASCOT_V2_ASSET_PREFIX', originalV2Prefix);
  });

  function restoreEnvironment(key: string, value?: string) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  function createService(prisma: any) {
    const auth = { getUserById: jest.fn().mockResolvedValue({ id: 7 }) };
    const storage = { fileExists: jest.fn() };
    return new PfpService(prisma, auth as any, storage as any);
  }

  it('preserves an existing v1 assignment after v2 becomes active', async () => {
    delete process.env.MASCOT_CATALOG_VERSION;
    const existing = {
      mascotKey: 'CTO2',
      assignedAt: new Date('2026-08-16T00:00:00Z'),
    };
    const prisma = {
      mascotAssignment: { findUnique: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn(),
    };

    const result = await createService(prisma).getOrAssignMascot(7);

    expect(result).toMatchObject({
      mascotKey: 'CTO2',
      assetVersion: 'v1',
      assetPath: 'mascots/TRAITS/CTO2.png',
      catalogSize: 146,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allocates the only least-used v2 finished PFP', async () => {
    delete process.env.MASCOT_CATALOG_VERSION;
    delete process.env.MASCOT_PFP_KEYS;
    const target = 'V2_00146';
    const usage = DEFAULT_MASCOT_V2_KEYS.filter(
      (mascotKey) => mascotKey !== target,
    ).map((mascotKey) => ({ mascotKey, _count: { mascotKey: 1 } }));
    const database = {
      mascotAssignment: {
        findUnique: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue(usage),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({
              ...data,
              assignedAt: new Date('2026-08-16T00:00:00Z'),
            }),
          ),
      },
    };
    const prisma = {
      mascotAssignment: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockImplementation((callback) => callback(database)),
    };

    const result = await createService(prisma).getOrAssignMascot(7);

    expect(result).toMatchObject({
      mascotKey: target,
      assetVersion: 'v2',
      assetPath: 'mascots/v2/full/00146.png',
      catalogSize: 146,
    });
    expect(database.mascotAssignment.create).toHaveBeenCalledWith({
      data: { userId: 7, mascotKey: target },
    });
  });

  it('supports an explicit rollback to the legacy v1 catalogue', async () => {
    process.env.MASCOT_CATALOG_VERSION = 'v1';
    process.env.MASCOT_TRAIT_KEYS = 'NEW_ONE,NEW_TWO';
    const target = 'NEW_TWO';
    const usage = [{ mascotKey: 'NEW_ONE', _count: { mascotKey: 1 } }];
    const database = {
      mascotAssignment: {
        findUnique: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue(usage),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({
              ...data,
              assignedAt: new Date('2026-08-16T00:00:00Z'),
            }),
          ),
      },
    };
    const prisma = {
      mascotAssignment: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockImplementation((callback) => callback(database)),
    };

    const result = await createService(prisma).getOrAssignMascot(7);

    expect(result).toMatchObject({
      mascotKey: target,
      assetVersion: 'v1',
      assetPath: 'mascots/TRAITS/NEW_TWO.png',
      catalogSize: 2,
    });
  });

  it('keeps all 24 legacy defaults available for rollback', () => {
    expect(DEFAULT_MASCOT_TRAIT_KEYS).toHaveLength(24);
  });
});
