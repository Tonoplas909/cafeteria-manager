import { useState } from 'react';
import Dialog from '../Dialog.jsx';
import { PlusIcon } from '../icons.jsx';
import { useT } from '../i18n.jsx';
import Michel from '../Michel.jsx';

const TABS = [
  ['staff', 'Staff'],
  ['products', 'Products'],
  ['calendar', 'Calendars'],
];

function MemberCard({ member, isSelf, onToggle, onRemove, onSendLink }) {
  const { t } = useT();
  const admin = member.role === 'admin';
  return (
    <div className="card elev-sm row-card">
      <div className={`avatar ${admin ? 'avatar-admin' : 'avatar-staff'}`}>{member.name.charAt(0)}</div>
      <div className="row-main">
        <div className="row-name">{member.name}</div>
        <div className="row-sub">{member.email}</div>
      </div>
      <span className={admin ? 'tag tag-accent' : 'tag tag-accent-2'}>{admin ? t('Admin') : t('Staff')}</span>
      {!isSelf && (
        <button className="btn btn-ghost" onClick={() => onToggle(member.id)}>
          {admin ? t('Make staff') : t('Make admin')}
        </button>
      )}
      <button className="btn btn-ghost" onClick={() => onSendLink(member)}>{t('Send password link')}</button>
      {!isSelf && <button className="btn btn-ghost" onClick={() => onRemove(member.id)}>{t('Remove')}</button>}
    </div>
  );
}

export default function Admin({ staff, inventory, calendars, actions, me }) {
  const { t, fmtDate } = useT();
  const [tab, setTab] = useState('staff');
  const [dialog, setDialog] = useState(null); // 'staff' | 'product'
  const [notice, setNotice] = useState(null); // confirmation after sending an email
  const close = () => setDialog(null);
  const sendLink = async (member) => {
    setNotice(null);
    const ok = await actions.sendLink(member.email);
    if (ok) setNotice(t('Password link sent to {email}.', { email: member.email }));
  };
  const cardProps = {
    onToggle: actions.toggleRole,
    onRemove: actions.removeStaff,
    onSendLink: sendLink,
  };

  const admins = staff.filter((m) => m.role === 'admin');
  const staffOnly = staff.filter((m) => m.role !== 'admin');

  return (
    <div className="screen-inner">
      <div className="page-intro">
        <Michel pose="boss" className="michel-head" />
        <div className="eyebrow">{t('Setup')}</div>
        <h1 className="page-title">{t('Team and menu')}</h1>
        <p className="page-lede">
          {t('Who can staff the café, what it sells, and which calendars feed the schedule.')}
        </p>
      </div>

      {notice && (
        <div className="card elev-sm notice" role="status">
          <div>{notice}</div>
          <button className="btn btn-secondary" onClick={() => setNotice(null)}>{t('Dismiss')}</button>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            className="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {tab === 'staff' && (
        <div className="stack gap-4">
          <button className="btn btn-primary self-start" onClick={() => setDialog('staff')}>
            <PlusIcon /> {t('Add staff member')}
          </button>
          <div className="section-title">{t('Admins')}</div>
          <div className="stack gap-3">
            {admins.map((m) => (
              <MemberCard key={m.id} member={m} isSelf={m.id === me?.id} {...cardProps} />
            ))}
          </div>
          <div className="section-title">{t('Staff')}</div>
          <div className="stack gap-3">
            {staffOnly.length === 0 && <p className="text-muted" style={{ margin: 0 }}>{t('No staff members yet.')}</p>}
            {staffOnly.map((m) => (
              <MemberCard key={m.id} member={m} isSelf={m.id === me?.id} {...cardProps} />
            ))}
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div className="stack gap-4">
          <button className="btn btn-primary self-start" onClick={() => setDialog('product')}>
            <PlusIcon /> {t('Add product')}
          </button>
          <div className="stack gap-3">
            {inventory.length === 0 && <p className="text-muted" style={{ margin: 0 }}>{t('No products yet.')}</p>}
            {inventory.map((item) => (
              <div key={item.id} className="card elev-sm row-card" style={{ gap: 'var(--space-6)' }}>
                <div className="row-main row-name">{item.name}</div>
                <div className="row-sub">{t('Cost')} €{item.cost}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t('Price')} €{item.price}</div>
                <button className="btn btn-ghost" onClick={() => actions.removeProduct(item.id)}>{t('Remove')}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'calendar' && (
        <div className="stack gap-4">
          <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-3)' }}>
            <div className="section-title">{t('Connected calendars')}</div>
            <p style={{ margin: 0, fontSize: 15, maxWidth: '60ch', color: 'var(--color-neutral-700)' }}>
              {t('Each person connects their own calendar from “My calendar”. Only whether they are busy during a shift is used.')}
            </p>
          </div>
          <div className="stack gap-3">
            {calendars.length === 0 && <p className="text-muted" style={{ margin: 0 }}>{t('Nobody has connected a calendar yet.')}</p>}
            {calendars.map((cal) => (
              <div key={cal.id} className="card elev-sm row-card">
                <div className="row-main">
                  <div className="row-name">{cal.name}</div>
                  <div className="row-sub">{t('Last synced {date}', { date: fmtDate(cal.lastSync) })}</div>
                </div>
                <span className="tag tag-accent-2">{t('Connected')}</span>
                <button className="btn btn-ghost" onClick={() => actions.disconnectCalendar(cal.id)}>
                  {t('Disconnect')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {dialog === 'staff' && (
        <Dialog
          title={t('Add staff member')}
          submitLabel="Send invitation"
          onClose={close}
          onSubmit={async (d) => {
            const email = d.get('email').trim();
            close();
            setNotice(null);
            const ok = await actions.addStaff({
              name: d.get('name').trim(),
              email,
              role: d.get('admin') ? 'admin' : 'staff',
            });
            if (ok) setNotice(t('Invitation sent to {email}. They choose their own password from the link.', { email }));
          }}
        >
          <div className="field">
            <label htmlFor="s-name">{t('Name')}</label>
            <input id="s-name" name="name" className="input" autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="s-email">{t('Email')}</label>
            <input id="s-email" name="email" type="email" className="input" required />
          </div>
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
            {t('We email them a link to choose their own password, so nobody else ever sees it.')}
          </p>
          <label className="dialog-check">
            <input type="checkbox" name="admin" /> {t('Make this person an admin')}
          </label>
        </Dialog>
      )}

      {dialog === 'product' && (
        <Dialog
          title={t('Add product')}
          submitLabel="Add"
          onClose={close}
          onSubmit={(d) => {
            actions.addProduct({
              name: d.get('name').trim(),
              cost: parseFloat(d.get('cost')),
              price: parseFloat(d.get('price')),
            });
            close();
          }}
        >
          <div className="field">
            <label htmlFor="p-name">{t('Product name')}</label>
            <input id="p-name" name="name" className="input" autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="p-cost">{t('Cost per unit (€)')}</label>
            <input id="p-cost" name="cost" type="number" min="0" step="any" className="input" required />
          </div>
          <div className="field">
            <label htmlFor="p-price">{t('Selling price (€)')}</label>
            <input id="p-price" name="price" type="number" min="0" step="any" className="input" required />
          </div>
        </Dialog>
      )}
    </div>
  );
}
