import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileInput } from '@hallway/shared';

test('LinkedIn URLs are optional and restricted to LinkedIn over HTTPS', () => {
  const profile = {
    nickname: 'Jordan',
    background: '',
    interests: ['Kubernetes'],
    goals: 'Meet the community',
    firstTime: true,
    comfort: 'quiet',
    difficulty: 'easy',
  };
  assert.equal(profileInput.parse(profile).linkedinUrl, '');
  assert.equal(
    profileInput.parse({ ...profile, linkedinUrl: 'https://www.linkedin.com/in/jordan' })
      .linkedinUrl,
    'https://www.linkedin.com/in/jordan',
  );
  assert.equal(
    profileInput.safeParse({ ...profile, linkedinUrl: 'https://example.com/in/jordan' }).success,
    false,
  );
  assert.equal(
    profileInput.safeParse({ ...profile, linkedinUrl: 'http://linkedin.com/in/jordan' }).success,
    false,
  );
});
