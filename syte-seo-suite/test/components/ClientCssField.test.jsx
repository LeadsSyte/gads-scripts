// "Client CSS" on the CMS page: paste or upload a stylesheet, see what was
// kept, remove it. The profile is only changed through setP (saved by
// "Save Profile").

import { describe, test, expect } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientCssField from '../../src/modules/cms/ClientCssField.jsx';
import { PROFILE_DEFAULTS } from '../../src/modules/cms/publishingProfile.js';

function Harness({ start = {} }) {
  const [profile, setProfile] = useState({ ...PROFILE_DEFAULTS, ...start });
  const setP = (k, v) => setProfile(p => ({ ...p, [k]: v }));
  return (<><ClientCssField profile={profile} setP={setP} disabled={false} /><pre data-testid="css">{profile.client_css || ''}</pre></>);
}

describe('Client CSS field', () => {
  test('starts empty, pasting CSS keeps only the article styling, confined to our content', async () => {
    render(<Harness />);
    expect(screen.getByText(/None — articles use the site's own styles/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Paste CSS' }));
    fireEvent.change(screen.getByPlaceholderText(/h2 \{/), { target: { value: 'h2{color:#123}\n.site-header nav a{color:red}' } });
    await userEvent.click(screen.getByRole('button', { name: 'Use this CSS' }));
    expect(screen.getByTestId('css').textContent).toBe('.syte-content h2{color:#123}');
    expect(screen.getByText(/1 rule kept for articles/)).toBeTruthy();
    expect(screen.getByText(/1 left out/)).toBeTruthy();
    expect(screen.getByText(/Save Profile/)).toBeTruthy();
  });

  test('a stylesheet with nothing for articles is refused with a reason', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Paste CSS' }));
    fireEvent.change(screen.getByPlaceholderText(/h2 \{/), { target: { value: '.site-header nav a{color:red} footer{padding:0}' } });
    await userEvent.click(screen.getByRole('button', { name: 'Use this CSS' }));
    expect(screen.getByText(/nothing was kept/)).toBeTruthy();
    expect(screen.getByTestId('css').textContent).toBe('');
  });

  test('uploading a .css file works the same, and Remove clears it', async () => {
    render(<Harness />);
    const input = document.querySelector('input[type=file]');
    const file = new File(['body{font-family:Lato} .entry-content h3{color:#000}'], 'theme.css', { type: 'text/css' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('css').textContent).toContain('.syte-content h3{color:#000}'));
    expect(screen.getByText('theme.css')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByTestId('css').textContent).toBe('');
  });
});
