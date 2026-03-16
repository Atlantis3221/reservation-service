import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db', () => ({
  getDb: () => testDb,
}));

import {
  isValidSlug,
  generateSlug,
  isSlugTaken,
  createBusiness,
  getBusinessBySlug,
  getBusinessById,
  getBusinessesByOwner,
  getBusinessByOwner,
  getBusinessByOwnerAndSlug,
  updateBusinessName,
  updateBusinessSlug,
  updateTelegramUsername,
  deleteBusiness,
  hasAgreement,
  saveAgreement,
  ownerHasPhone,
  getOwnerPhone,
  updateOwnerPhone,
} from '../business';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE businesses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      slug              TEXT    NOT NULL UNIQUE,
      name              TEXT    NOT NULL,
      owner_chat_id     TEXT    NOT NULL,
      telegram_username TEXT,
      owner_phone       TEXT,
      agreement_accepted_at TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE slots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id  INTEGER NOT NULL,
      date_key     TEXT    NOT NULL,
      start_time   TEXT    NOT NULL,
      end_time     TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'available',
      note         TEXT,
      client_name  TEXT,
      client_phone TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);
  db.exec('CREATE INDEX idx_slots_business_date ON slots(business_id, date_key)');

  db.exec(`
    CREATE TABLE owner_agreements (
      owner_chat_id  TEXT PRIMARY KEY,
      accepted_at    TEXT NOT NULL DEFAULT (datetime('now')),
      phone          TEXT
    )
  `);
}

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  createSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ---- isValidSlug ----

describe('isValidSlug', () => {
  it('accepts valid slug', () => {
    expect(isValidSlug('my-banya')).toBe(true);
  });

  it('accepts slug with digits', () => {
    expect(isValidSlug('banya-42')).toBe(true);
  });

  it('rejects slug shorter than 3 chars', () => {
    expect(isValidSlug('ab')).toBe(false);
  });

  it('rejects slug starting with hyphen', () => {
    expect(isValidSlug('-abc')).toBe(false);
  });

  it('rejects slug ending with hyphen', () => {
    expect(isValidSlug('abc-')).toBe(false);
  });

  it('rejects slug with uppercase', () => {
    expect(isValidSlug('MySlug')).toBe(false);
  });

  it('rejects slug with special characters', () => {
    expect(isValidSlug('my_slug')).toBe(false);
  });

  it('accepts minimum length slug (3 chars)', () => {
    expect(isValidSlug('abc')).toBe(true);
  });
});

// ---- generateSlug ----

describe('generateSlug', () => {
  it('transliterates Russian name', () => {
    const slug = generateSlug('Моя баня');
    expect(slug).toBe('moya-banya');
  });

  it('adds suffix for very short names', () => {
    const slug = generateSlug('Ба');
    expect(slug).toContain('banya');
  });

  it('handles collision by appending number', () => {
    testDb.prepare(
      "INSERT INTO businesses (slug, name, owner_chat_id) VALUES ('test-slug', 'Test', '1')"
    ).run();

    const slug = generateSlug('test slug');
    expect(slug).toBe('test-slug-2');
  });

  it('trims to max 60 characters', () => {
    const longName = 'а'.repeat(100);
    const slug = generateSlug(longName);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('removes leading and trailing hyphens', () => {
    const slug = generateSlug('  Моя баня  ');
    expect(slug).not.toMatch(/^-|-$/);
  });
});

// ---- CRUD ----

describe('createBusiness + getBusinessBySlug', () => {
  it('creates and retrieves business', () => {
    const biz = createBusiness('test-banya', 'Тест Баня', '12345', 'testuser');

    expect(biz.slug).toBe('test-banya');
    expect(biz.name).toBe('Тест Баня');
    expect(biz.ownerChatId).toBe('12345');
    expect(biz.telegramUsername).toBe('testuser');

    const found = getBusinessBySlug('test-banya');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Тест Баня');
  });

  it('returns null for non-existent slug', () => {
    expect(getBusinessBySlug('no-such-slug')).toBeNull();
  });
});

describe('getBusinessById', () => {
  it('returns business by id', () => {
    const biz = createBusiness('test', 'Test', '1');
    const found = getBusinessById(biz.id);
    expect(found).not.toBeNull();
    expect(found!.slug).toBe('test');
  });

  it('returns null for non-existent id', () => {
    expect(getBusinessById(999)).toBeNull();
  });
});

describe('getBusinessesByOwner / getBusinessByOwner', () => {
  it('returns all businesses for owner', () => {
    createBusiness('biz-1', 'Biz 1', '100');
    createBusiness('biz-2', 'Biz 2', '100');
    createBusiness('biz-3', 'Biz 3', '200');

    const list = getBusinessesByOwner('100');
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.slug)).toEqual(['biz-1', 'biz-2']);
  });

  it('getBusinessByOwner returns first business', () => {
    createBusiness('first', 'First', '100');
    createBusiness('second', 'Second', '100');

    const biz = getBusinessByOwner('100');
    expect(biz).not.toBeNull();
    expect(biz!.slug).toBe('first');
  });

  it('getBusinessByOwner returns null when no businesses', () => {
    expect(getBusinessByOwner('999')).toBeNull();
  });
});

describe('getBusinessByOwnerAndSlug', () => {
  it('returns business matching both owner and slug', () => {
    createBusiness('my-biz', 'My Biz', '100');
    createBusiness('my-biz-2', 'Other Biz', '200');

    expect(getBusinessByOwnerAndSlug('100', 'my-biz')).not.toBeNull();
    expect(getBusinessByOwnerAndSlug('200', 'my-biz')).toBeNull();
  });
});

// ---- Updates ----

describe('updateBusinessName', () => {
  it('updates business name', () => {
    const biz = createBusiness('test', 'Old Name', '1');
    updateBusinessName(biz.id, 'New Name');

    const found = getBusinessById(biz.id);
    expect(found!.name).toBe('New Name');
  });
});

describe('updateBusinessSlug', () => {
  it('updates business slug', () => {
    const biz = createBusiness('old-slug', 'Test', '1');
    updateBusinessSlug(biz.id, 'new-slug');

    expect(getBusinessBySlug('new-slug')).not.toBeNull();
    expect(getBusinessBySlug('old-slug')).toBeNull();
  });
});

describe('updateTelegramUsername', () => {
  it('updates username for all businesses of owner', () => {
    createBusiness('biz-a', 'A', '100', 'old_user');
    createBusiness('biz-b', 'B', '100', 'old_user');

    updateTelegramUsername('100', 'new_user');

    const list = getBusinessesByOwner('100');
    for (const b of list) {
      expect(b.telegramUsername).toBe('new_user');
    }
  });
});

// ---- Delete ----

describe('deleteBusiness', () => {
  it('deletes business and its slots', () => {
    const biz = createBusiness('to-delete', 'Delete Me', '1');
    testDb.prepare(
      "INSERT INTO slots (business_id, date_key, start_time, end_time, status) VALUES (?, '2026-03-16', '10:00', '14:00', 'available')"
    ).run(biz.id);

    deleteBusiness(biz.id);

    expect(getBusinessById(biz.id)).toBeNull();
    const slots = testDb.prepare('SELECT * FROM slots WHERE business_id = ?').all(biz.id);
    expect(slots).toHaveLength(0);
  });
});

// ---- isSlugTaken ----

describe('isSlugTaken', () => {
  it('returns true for existing slug', () => {
    createBusiness('taken', 'Taken', '1');
    expect(isSlugTaken('taken')).toBe(true);
  });

  it('returns false for free slug', () => {
    expect(isSlugTaken('available')).toBe(false);
  });
});

// ---- Agreements & Phone ----

describe('agreements', () => {
  it('hasAgreement returns false initially', () => {
    expect(hasAgreement('100')).toBe(false);
  });

  it('saveAgreement + hasAgreement', () => {
    saveAgreement('100');
    expect(hasAgreement('100')).toBe(true);
  });

  it('saveAgreement is idempotent', () => {
    saveAgreement('100');
    saveAgreement('100');
    expect(hasAgreement('100')).toBe(true);
  });
});

describe('owner phone', () => {
  it('ownerHasPhone returns false initially', () => {
    expect(ownerHasPhone('100')).toBe(false);
  });

  it('updateOwnerPhone saves phone', () => {
    updateOwnerPhone('100', '+79001234567');
    expect(ownerHasPhone('100')).toBe(true);
    expect(getOwnerPhone('100')).toBe('+79001234567');
  });

  it('updateOwnerPhone updates existing businesses', () => {
    createBusiness('biz-phone', 'Phone Biz', '100');
    updateOwnerPhone('100', '+79001234567');

    const biz = getBusinessBySlug('biz-phone');
    expect(biz!.ownerPhone).toBe('+79001234567');
  });

  it('getOwnerPhone returns null when not set', () => {
    expect(getOwnerPhone('999')).toBeNull();
  });
});
