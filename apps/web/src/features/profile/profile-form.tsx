import { interests, profileInput, type ProfileInput } from '@hallway/shared';
import { attendeeSchema, githubProfileSchema } from '@hallway/shared/responses';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Github } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { api, useAction, type User } from '../../shared/api';
import { Button, Checkbox, ErrorText, Input, NativeSelect, Textarea } from '../../shared/ui';

const defaults: ProfileInput = {
  nickname: '',
  background: '',
  interests: [],
  goals: '',
  firstTime: true,
  comfort: 'warming-up',
  difficulty: 'easy',
  showOnQuestLeaderboard: false,
  discoverable: false,
  shareBackground: false,
  linkedinUrl: '',
  shareLinkedIn: false,
};
export function ProfileForm({
  user,
  onUser,
  onboarding = false,
}: {
  user: User;
  onUser: (user: User) => void;
  onboarding?: boolean;
}) {
  const leaderboardDescriptionId = useId();
  const form = useForm<ProfileInput>({
    defaultValues: user.profile ?? defaults,
    resolver: zodResolver(profileInput),
  });
  const save = useAction(
    (profile: ProfileInput) => api('/profile', attendeeSchema, 'PUT', profile),
    ['today', 'catalog', 'people', 'quest-leaderboard'],
  );
  const github = useAction((username: string) => {
    return api('/github/' + encodeURIComponent(username), githubProfileSchema);
  });
  const publicProfile = github.data;
  const [login, setLogin] = useState('');
  const chosen = form.watch('interests');
  const discoverable = form.watch('discoverable');
  const linkedinUrl = form.watch('linkedinUrl');
  const fieldError = Object.values(form.formState.errors)[0]?.message;
  const submit = form.handleSubmit((profile) => save.run(profile, { onSuccess: onUser }));

  function applyGitHubProfile() {
    if (!publicProfile) return;
    form.setValue('nickname', publicProfile.nickname);
    form.setValue('background', publicProfile.background);
    github.reset();
  }

  function toggleInterest(interest: ProfileInput['interests'][number]) {
    const updated = chosen.includes(interest)
      ? chosen.filter((item) => item !== interest)
      : [...chosen, interest];
    form.setValue('interests', updated, { shouldValidate: true });
  }

  return (
    <form className="form profile-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Nickname
          <Input {...form.register('nickname')} placeholder="What should we call you?" />
        </label>
        <label>
          Professional background
          <Input {...form.register('background')} placeholder="e.g. Platform engineer" />
        </label>
      </div>
      <label>
        LinkedIn profile URL <span className="muted">(optional)</span>
        <Input
          {...form.register('linkedinUrl')}
          type="url"
          inputMode="url"
          placeholder="https://www.linkedin.com/in/you"
          autoComplete="url"
        />
      </label>
      <div className="github-line">
        <label>
          GitHub username <span className="muted">(optional)</span>
          <Input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="octocat"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => github.run(login.trim())}
          disabled={!login.trim() || github.loading}
        >
          <Github size={17} /> Preview
        </Button>
      </div>
      <ErrorText error={github.error} />
      {publicProfile && (
        <div className="inline-note">
          <div>
            <strong>{publicProfile.nickname}</strong>
            <p>{publicProfile.background}</p>
          </div>
          <Button variant="secondary" onClick={applyGitHubProfile}>
            Apply public profile
          </Button>
        </div>
      )}
      <fieldset>
        <legend>What are you interested in?</legend>
        <div className="chips">
          {interests.map((interest) => (
            <Button
              variant="ghost"
              type="button"
              key={interest}
              aria-pressed={chosen.includes(interest)}
              className={'chip ' + (chosen.includes(interest) ? 'selected' : '')}
              onClick={() => toggleInterest(interest)}
            >
              {interest}
            </Button>
          ))}
        </div>
      </fieldset>
      <label>
        Conference goals
        <Textarea
          rows={2}
          {...form.register('goals')}
          placeholder="What would make this conference a win for you?"
        />
      </label>
      <div className="form-grid">
        <label>
          Networking comfort
          <NativeSelect {...form.register('comfort')}>
            <option value="quiet">I prefer a quiet start</option>
            <option value="warming-up">I’m warming up</option>
            <option value="outgoing">I’m ready to meet people</option>
          </NativeSelect>
        </label>
        <label>
          Quest difficulty
          <NativeSelect {...form.register('difficulty')}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </NativeSelect>
        </label>
      </div>
      <label className="check-label">
        <Controller
          control={form.control}
          name="firstTime"
          render={({ field }) => (
            <Checkbox checked={field.value} onCheckedChange={field.onChange} ref={field.ref} />
          )}
        />{' '}
        This is my first time at this conference
      </label>
      <div>
        <label className="check-label">
          <Controller
            control={form.control}
            name="showOnQuestLeaderboard"
            render={({ field }) => (
              <Checkbox
                checked={field.value}
                onCheckedChange={field.onChange}
                ref={field.ref}
                aria-describedby={leaderboardDescriptionId}
              />
            )}
          />
          Show me on the quest leaderboard
        </label>
        <small id={leaderboardDescriptionId} className="block pl-6 muted">
          Share your nickname and total quest XP with signed-in attendees.
        </small>
      </div>
      <label className="check-label">
        <Controller
          control={form.control}
          name="discoverable"
          render={({ field }) => (
            <Checkbox checked={field.value} onCheckedChange={field.onChange} ref={field.ref} />
          )}
        />{' '}
        Let other attendees discover me
      </label>
      {discoverable && (
        <>
          <label className="check-label">
            <Controller
              control={form.control}
              name="shareBackground"
              render={({ field }) => (
                <Checkbox checked={field.value} onCheckedChange={field.onChange} ref={field.ref} />
              )}
            />{' '}
            Show my professional background to attendees
          </label>
          {linkedinUrl.trim() && (
            <label className="check-label">
              <Controller
                control={form.control}
                name="shareLinkedIn"
                render={({ field }) => (
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    ref={field.ref}
                  />
                )}
              />{' '}
              Show my LinkedIn profile to attendees
            </label>
          )}
        </>
      )}
      {fieldError && (
        <p className="error" role="alert">
          {fieldError}
        </p>
      )}
      <ErrorText error={save.error} />
      <div>
        <Button type="submit" disabled={save.loading}>
          {onboarding ? 'Go to Today' : 'Save preferences'} <ArrowRight size={17} />
        </Button>{' '}
        {save.data && !onboarding && (
          <span role="status" className="muted">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
