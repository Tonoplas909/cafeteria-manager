import chill from './assets/michel/chill.webp';
import megaphone from './assets/michel/megaphone.webp';
import cheer from './assets/michel/cheer.webp';
import chef from './assets/michel/chef.webp';
import boss from './assets/michel/boss.webp';

const POSES = { chill, megaphone, cheer, chef, boss };

// Michel, the café's penguin. Purely decorative, so screen readers skip him.
export default function Michel({ pose, className = '' }) {
  return <img src={POSES[pose]} alt="" aria-hidden="true" className={`michel ${className}`} decoding="async" />;
}
