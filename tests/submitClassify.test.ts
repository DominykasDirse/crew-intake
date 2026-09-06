import { classifyError } from '@/offline/classify';

describe('send outcome classification', () => {
  it('server refusals are permanent: privilege (editing closed / wrong form) and invalid input', () => {
    expect(classifyError({ code: '42501', message: 'editing closed' }).permanent).toBe(true);
    expect(classifyError({ code: '22023', message: 'report date out of window' }).permanent).toBe(
      true,
    );
  });
  it('network failures, timeouts, 5xx and unknown errors are transient (retry with backoff)', () => {
    expect(classifyError({ message: 'Network request failed' }).permanent).toBe(false);
    expect(
      classifyError({ code: '57014', message: 'canceling statement due to statement timeout' })
        .permanent,
    ).toBe(false);
    expect(classifyError({ code: 'PGRST301', message: 'JWT expired' }).permanent).toBe(false);
    expect(classifyError(null).permanent).toBe(false);
  });
});
