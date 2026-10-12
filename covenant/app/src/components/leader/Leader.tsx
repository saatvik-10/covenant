import type { ReactNode, Row } from "../../helpers/types";

export function Leader({ k, v }: Row) {
  return (
    <div className="leader">
      <span className="k">{k}</span>
      <span className="dots" aria-hidden="true" />
      <span className="v">{v}</span>
    </div>
  );
}

export function LeaderJSX({ k, vJSX }: { k: string; vJSX: ReactNode }) {
  return (
    <div className="leader">
      <span className="k">{k}</span>
      <span className="dots" aria-hidden="true" />
      {vJSX}
    </div>
  );
}
