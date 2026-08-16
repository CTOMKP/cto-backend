import { DEFAULT_MASCOT_TRAIT_KEYS, PfpService } from "./pfp.service";

describe("PfpService mascot assignment", () => {
  const originalCatalog = process.env.MASCOT_TRAIT_KEYS;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalCatalog === undefined) delete process.env.MASCOT_TRAIT_KEYS;
    else process.env.MASCOT_TRAIT_KEYS = originalCatalog;
  });

  function createService(prisma: any) {
    const auth = { getUserById: jest.fn().mockResolvedValue({ id: 7 }) };
    const storage = { fileExists: jest.fn() };
    return new PfpService(prisma, auth as any, storage as any);
  }

  it("returns the existing assignment without reallocating", async () => {
    const existing = {
      mascotKey: "CTO2",
      assignedAt: new Date("2026-08-16T00:00:00Z"),
    };
    const prisma = {
      mascotAssignment: { findUnique: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn(),
    };
    const result = await createService(prisma).getOrAssignMascot(7);
    expect(result.mascotKey).toBe("CTO2");
    expect(result.catalogSize).toBe(24);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allocates the only least-used active mascot", async () => {
    delete process.env.MASCOT_TRAIT_KEYS;
    const target = "HODLER";
    const usage = DEFAULT_MASCOT_TRAIT_KEYS.filter(
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
              assignedAt: new Date("2026-08-16T00:00:00Z"),
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
    expect(result.mascotKey).toBe(target);
    expect(database.mascotAssignment.create).toHaveBeenCalledWith({
      data: { userId: 7, mascotKey: target },
    });
  });

  it("accepts a replacement catalogue from the environment", async () => {
    process.env.MASCOT_TRAIT_KEYS = "NEW_ONE,NEW_TWO";
    const existing = {
      mascotKey: "NEW_TWO",
      assignedAt: new Date("2026-08-16T00:00:00Z"),
    };
    const prisma = {
      mascotAssignment: { findUnique: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn(),
    };
    const result = await createService(prisma).getOrAssignMascot(7);
    expect(result.catalogSize).toBe(2);
    expect(result.mascotKey).toBe("NEW_TWO");
  });
});
