import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import request from 'supertest';
import { app } from '../../app';
import { COLLECTIONS } from '../../db/collections';
import { Role } from '../../types/roles';
import { generateToken } from '../helpers/auth';
import {
  parseCollegeEmailDomain,
  emailDomainOf,
  domainCoveredBy,
  domainsOverlap,
} from '../../modules/college/emailDomain.util';

describe('emailDomain helpers', () => {
  it('normalizes a valid domain (trim, lowercase, leading @)', () => {
    expect(parseCollegeEmailDomain('  @XavierTech.AC.in ')).toEqual({ domain: 'xaviertech.ac.in' });
  });

  it.each([
    ['gmail.com'], ['mail.yahoo.com'], ['ac.in'], ['co.uk'], ['edu.in'], ['localhost'], ['a b.com'],
    ['-bad.com'], [''], ['x@y.com'], ['http://x.com'],
  ])('rejects %j', (input) => {
    expect('error' in parseCollegeEmailDomain(input)).toBe(true);
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 5, {}, []]) expect('error' in parseCollegeEmailDomain(v)).toBe(true);
  });

  it('extracts the domain of an email, lowercased, and ignores the roll-number prefix', () => {
    expect(emailDomainOf('2406138.jeswinjjmm@Student.XavierTech.ac.in')).toBe('student.xaviertech.ac.in');
    for (const bad of ['', 'no-at-sign', '@x.com', 'a@', 'a@b', 5, null]) expect(emailDomainOf(bad)).toBeNull();
  });

  it('covers the domain and its subdomains only, splitting on a dot', () => {
    expect(domainCoveredBy('xaviertech.ac.in', 'xaviertech.ac.in')).toBe(true);
    expect(domainCoveredBy('student.xaviertech.ac.in', 'xaviertech.ac.in')).toBe(true);
    expect(domainCoveredBy('a.b.xaviertech.ac.in', 'xaviertech.ac.in')).toBe(true);
    expect(domainCoveredBy('evil-xaviertech.ac.in', 'xaviertech.ac.in')).toBe(false);
    expect(domainCoveredBy('xaviertech.ac.in.attacker.com', 'xaviertech.ac.in')).toBe(false);
    expect(domainCoveredBy('ac.in', 'xaviertech.ac.in')).toBe(false);
  });

  it('detects overlapping domains in both directions', () => {
    expect(domainsOverlap('mit.edu', 'cs.mit.edu')).toBe(true);
    expect(domainsOverlap('cs.mit.edu', 'mit.edu')).toBe(true);
    expect(domainsOverlap('mit.edu', 'mit.ac.in')).toBe(false);
  });
});

describe('College email domains: API', () => {
  const db = admin.firestore();
  const rootToken = () => generateToken({ uid: 'root-1', email: 'root@x.com', role: Role.ADMIN, collegeId: null });
  const scopedToken = (collegeId: string) =>
    generateToken({ uid: 'adm-1', email: 'adm@x.com', role: Role.ADMIN, collegeId });
  const createCollege = (body: object) =>
    request(app).post('/api/colleges').set('Authorization', `Bearer ${rootToken()}`).send(body);
  const register = (email: string, extra: object = {}) =>
    request(app).post('/api/auth/register').send({ email, password: 'password123', role: Role.STUDENT, ...extra });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).doc('root-1').set({ role: Role.ADMIN, collegeId: null });
  });

  describe('setting a domain', () => {
    it('a root admin can create a college with a normalized emailDomain', async () => {
      const res = await createCollege({ name: 'Xavier', code: 'XT', emailDomain: ' @XavierTech.ac.in ' });
      expect(res.status).toBe(201);
      expect(res.body.data.emailDomain).toBe('xaviertech.ac.in');
      const stored = (await db.collection(COLLECTIONS.COLLEGES).doc(res.body.data.id).get()).data();
      expect(stored?.emailDomain).toBe('xaviertech.ac.in');
    });

    it('a college without an emailDomain still works', async () => {
      const res = await createCollege({ name: 'Plain', code: 'PL' });
      expect(res.status).toBe(201);
      expect(res.body.data.emailDomain).toBeUndefined();
    });

    it.each(['gmail.com', 'ac.in', 'not a domain'])('rejects an invalid or too broad domain %j (400)', async (d) => {
      const res = await createCollege({ name: 'Bad', code: 'B', emailDomain: d });
      expect(res.status).toBe(400);
    });

    it('rejects a second college with the same or an overlapping domain (409)', async () => {
      await createCollege({ name: 'One', code: '1', emailDomain: 'mit.ac.in' });
      for (const d of ['mit.ac.in', 'cs.mit.ac.in']) {
        const res = await createCollege({ name: 'Two', code: '2', emailDomain: d });
        expect(res.status, d).toBe(409);
      }
      const parent = await createCollege({ name: 'Three', code: '3', emailDomain: 'ac.mit.ac.in' });
      expect(parent.status).toBe(409);
    });

    it('PATCH sets, changes and clears a domain (root admin only)', async () => {
      const c = await createCollege({ name: 'One', code: '1' });
      const id = c.body.data.id;
      const set = await request(app).patch(`/api/colleges/${id}/email-domain`)
        .set('Authorization', `Bearer ${rootToken()}`).send({ emailDomain: 'one.edu.in' });
      expect(set.status).toBe(200);
      expect((await db.collection(COLLECTIONS.COLLEGES).doc(id).get()).data()?.emailDomain).toBe('one.edu.in');

      const forbidden = await request(app).patch(`/api/colleges/${id}/email-domain`)
        .set('Authorization', `Bearer ${scopedToken(id)}`).send({ emailDomain: 'other.edu.in' });
      expect(forbidden.status).toBe(403);

      const same = await request(app).patch(`/api/colleges/${id}/email-domain`)
        .set('Authorization', `Bearer ${rootToken()}`).send({ emailDomain: 'one.edu.in' });
      expect(same.status).toBe(200); // a college does not conflict with itself

      const clear = await request(app).patch(`/api/colleges/${id}/email-domain`)
        .set('Authorization', `Bearer ${rootToken()}`).send({ emailDomain: null });
      expect(clear.status).toBe(200);
      expect((await db.collection(COLLECTIONS.COLLEGES).doc(id).get()).data()?.emailDomain).toBeUndefined();
    });

    it('PATCH on a missing college is 404', async () => {
      const res = await request(app).patch('/api/colleges/nope/email-domain')
        .set('Authorization', `Bearer ${rootToken()}`).send({ emailDomain: 'x.edu.in' });
      expect(res.status).toBe(404);
    });
  });

  describe('registering by email domain', () => {
    let xavierId: string;
    let otherId: string;
    beforeEach(async () => {
      xavierId = (await createCollege({ name: 'Xavier', code: 'XT', emailDomain: 'xaviertech.ac.in' })).body.data.id;
      otherId = (await createCollege({ name: 'Open', code: 'OP' })).body.data.id;
    });

    it('places a student on a subdomain email into the college automatically, with no collegeId', async () => {
      const res = await register('2406138.jeswinjjmm@student.xaviertech.ac.in');
      expect(res.status).toBe(201);
      expect(res.body.user.collegeId).toBe(xavierId);
      expect(res.body.user.role).toBe(Role.STUDENT);
    });

    it('also matches the bare domain and any case', async () => {
      expect((await register('Someone@XavierTech.AC.IN')).body.user.collegeId).toBe(xavierId);
    });

    it('accepts a matching collegeId too, and an empty one is treated as missing', async () => {
      expect((await register('a@student.xaviertech.ac.in', { collegeId: xavierId })).status).toBe(201);
      expect((await register('b@student.xaviertech.ac.in', { collegeId: '' })).status).toBe(201);
    });

    it('rejects a collegeId that contradicts the email domain (400) and stores nothing', async () => {
      const res = await register('c@student.xaviertech.ac.in', { collegeId: otherId });
      expect(res.status).toBe(400);
      expect((await db.collection(COLLECTIONS.USERS).where('email', '==', 'c@student.xaviertech.ac.in').get()).empty).toBe(true);
    });

    it('rejects a foreign email that names a domain-restricted college by id (403)', async () => {
      const res = await register('intruder@gmail.com', { collegeId: xavierId });
      expect(res.status).toBe(403);
      expect((await db.collection(COLLECTIONS.USERS).where('email', '==', 'intruder@gmail.com').get()).empty).toBe(true);
    });

    it.each(['x@evil-xaviertech.ac.in', 'x@xaviertech.ac.in.attacker.com'])(
      'does not match look-alike domain %s',
      async (email) => {
        const res = await register(email);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('collegeId');
      }
    );

    it('an email on no known domain still registers into a college that has no domain, by id', async () => {
      const res = await register('free@gmail.com', { collegeId: otherId });
      expect(res.status).toBe(201);
      expect(res.body.user.collegeId).toBe(otherId);
    });

    it('an unknown collegeId is still rejected', async () => {
      const res = await register('free@gmail.com', { collegeId: 'no-such-college' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Unknown collegeId');
    });

    it('self-registration as TEACHER or ADMIN is still refused on a matching domain', async () => {
      for (const role of [Role.TEACHER, Role.ADMIN]) {
        const res = await register('t@xaviertech.ac.in', { role });
        expect(res.status).toBe(400);
      }
    });
  });
});
