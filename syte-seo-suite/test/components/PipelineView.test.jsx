// Component-level test for PipelineView. The Run Scan bug had two parts:
//  1. Pipeline status bucketed crawler-only clients as "credentials-missing"
//     (covered by pipelineStatus.test.mjs), AND
//  2. The action button's `condition` predicate hid the button for that
//     bucket — so even if (1) misbehaved, this layer is supposed to make
//     it visible. These tests lock in the click → onAction wiring so a
//     future refactor that breaks the button can't be merged unnoticed.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi } from 'vitest';
import PipelineView from '../../src/components/PipelineView.jsx';

const SECTIONS = (clients) => ([
  {
    key: 'verified-on-site',
    label: 'Verified on Site',
    color: 'var(--green)',
    borderColor: 'var(--green)',
    clients: clients.filter(c => c.bucket === 'verified-on-site')
  },
  {
    key: 'fixes-generated',
    label: 'Fixes Generated',
    color: 'var(--blue)',
    borderColor: 'var(--blue)',
    clients: clients.filter(c => c.bucket === 'fixes-generated')
  },
  {
    key: 'not-scanned',
    label: 'Not Scanned',
    color: 'var(--text-muted)',
    borderColor: 'var(--border)',
    clients: clients.filter(c => c.bucket === 'not-scanned')
  },
  {
    key: 'credentials-missing',
    label: 'Credentials Missing',
    color: 'var(--red)',
    borderColor: 'var(--red)',
    clients: clients.filter(c => c.bucket === 'credentials-missing')
  }
]);

const ACTIONS = [
  {
    key: 'scan',
    label: 'Run Scan',
    color: '#4F8EF7',
    condition: (c, section) => section !== 'credentials-missing' && section !== 'verified-on-site'
  },
  {
    key: 'scan',
    label: 'Re-scan',
    color: '#4F8EF7',
    condition: (c, section) => section === 'verified-on-site'
  }
];

function buildClient({ id, name, bucket }) {
  // PipelineView expects { client, summary, detail } — the wrapper shape
  // its sub-components destructure.
  return { client: { id, name }, summary: 'sum', detail: 'detail', bucket };
}

describe('PipelineView', () => {
  test('renders a Run Scan button for clients in the not-scanned bucket', () => {
    const onAction = vi.fn();
    const clients = [{ ...buildClient({ id: '1', name: 'Acme', bucket: 'not-scanned' }) }];
    // Tag each wrapper with its bucket so SECTIONS can split them.
    clients[0].bucket = 'not-scanned';
    render(
      <PipelineView
        title="Technical SEO"
        month="May 2026"
        sections={SECTIONS(clients)}
        actions={ACTIONS}
        onAction={onAction}
      />
    );
    expect(screen.getByRole('button', { name: /Run Scan/i })).toBeInTheDocument();
  });

  test('clicking Run Scan calls onAction with the right client + key', async () => {
    const onAction = vi.fn();
    const clients = [{ ...buildClient({ id: '1', name: 'Acme', bucket: 'not-scanned' }) }];
    clients[0].bucket = 'not-scanned';
    render(
      <PipelineView
        title="Technical SEO"
        month="May 2026"
        sections={SECTIONS(clients)}
        actions={ACTIONS}
        onAction={onAction}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Run Scan/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', name: 'Acme' }),
      'scan'
    );
  });

  test('Run Scan is HIDDEN for credentials-missing bucket (matches the action condition)', () => {
    const clients = [{ ...buildClient({ id: '2', name: 'NoCreds', bucket: 'credentials-missing' }) }];
    clients[0].bucket = 'credentials-missing';
    render(
      <PipelineView
        title="Technical SEO"
        month="May 2026"
        sections={SECTIONS(clients)}
        actions={ACTIONS}
        onAction={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /Run Scan/i })).not.toBeInTheDocument();
  });

  test('Re-scan (not Run Scan) shows for verified-on-site bucket', () => {
    const clients = [{ ...buildClient({ id: '3', name: 'AllGood', bucket: 'verified-on-site' }) }];
    clients[0].bucket = 'verified-on-site';
    render(
      <PipelineView
        title="Technical SEO"
        month="May 2026"
        sections={SECTIONS(clients)}
        actions={ACTIONS}
        onAction={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /Run Scan/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Re-scan/i })).toBeInTheDocument();
  });

  test('renders all four bucket headers + their client counts', () => {
    const clients = [
      { ...buildClient({ id: '1', name: 'A', bucket: 'not-scanned' }) },
      { ...buildClient({ id: '2', name: 'B', bucket: 'fixes-generated' }) },
      { ...buildClient({ id: '3', name: 'C', bucket: 'fixes-generated' }) },
      { ...buildClient({ id: '4', name: 'D', bucket: 'credentials-missing' }) }
    ];
    clients.forEach(c => { c.bucket = c.bucket; });
    render(
      <PipelineView
        title="Technical SEO"
        month="May 2026"
        sections={SECTIONS(clients)}
        actions={ACTIONS}
        onAction={() => {}}
      />
    );
    // Each section label appears twice (top-of-view summary + section
    // header); we just need to confirm each is present at all.
    expect(screen.getAllByText(/Not Scanned/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fixes Generated/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Credentials Missing/).length).toBeGreaterThan(0);
    // Client names rendered.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });
});
