import type { Stage } from '../../helpers/types';
import { STAGES } from '../../helpers/types';

export function Sidebar({
  stage,
  onPick,
}: {
  stage: Stage;
  onPick: (s: Stage) => void;
}) {
  return (
    <nav
      aria-label='Stages'
      className='hidden md:flex sticky top-0 h-screen w-40 shrink-0 flex-col justify-between border-r-2 border-ink px-3 py-6'
    >
      <div className='flex items-center gap-2 font-display text-lg leading-none tracking-tight'>
        <img src='/covenant-logo.svg' alt='' className='size-7.5' />
        COVENANT
      </div>
      <div className='flex flex-col gap-6'>
        {STAGES.map((s) => (
          <button
            key={s.id}
            type='button'
            onClick={() => onPick(s.id)}
            className='group text-left cursor-pointer'
            aria-current={stage === s.id}
          >
            <span className='numeral block text-6xl' data-live={stage === s.id}>
              {s.numeral}
            </span>
            <span className='mt-1 block text-[0.7rem] uppercase tracking-[0.25em] text-ink-soft group-hover:text-bronze transition-colors duration-150'>
              {s.label}
            </span>
          </button>
        ))}
      </div>
      <div className='font-semibold text-[0.6rem] uppercase tracking-[0.2em] text-ink-soft'>
        devnet
        <br />
        arbitrum sepolia
      </div>
    </nav>
  );
}
