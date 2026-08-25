import { describe, expect, it } from 'vitest';

import { extractPersonalMessageContent } from './message-content';

describe('extractPersonalMessageContent', () => {
  it('unwraps disappearing text messages', () => {
    expect(
      extractPersonalMessageContent({
        ephemeralMessage: { message: { conversation: 'Mensagem antiga' } },
      })
    ).toEqual({ contentType: 'text', contentText: 'Mensagem antiga' });
  });

  it('keeps historical media as typed placeholders', () => {
    expect(
      extractPersonalMessageContent({
        imageMessage: { caption: 'Comprovante' },
      })
    ).toEqual({ contentType: 'image', contentText: 'Comprovante' });
    expect(extractPersonalMessageContent({ audioMessage: {} })).toEqual({
      contentType: 'audio',
      contentText: null,
    });
  });

  it('maps button replies to interactive messages', () => {
    expect(
      extractPersonalMessageContent({
        buttonsResponseMessage: { selectedDisplayText: 'Quero saber mais' },
      })
    ).toEqual({
      contentType: 'interactive',
      contentText: 'Quero saber mais',
    });
  });

  it('ignores protocol-only events', () => {
    expect(extractPersonalMessageContent({ protocolMessage: {} })).toBeNull();
  });
});
