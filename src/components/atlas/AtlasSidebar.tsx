import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, X, Swords, Sparkles, Compass } from 'lucide-react';
import type { Sect } from '@/types';
import type { AtlasModel, SectNode } from '@/atlas/layout';

interface Props {
  model: AtlasModel;
  selected: SectNode | null;
  /** URL 里 ?sword= 指定的名剑 id（侧栏高亮并滚动到位） */
  focusSwordId: string | null;
  onClose: () => void;
  onLocate: (node: SectNode) => void;
  onSelectMissing: (sect: Sect) => void;
}

export default function AtlasSidebar({
  model,
  selected,
  focusSwordId,
  onClose,
  onLocate,
  onSelectMissing,
}: Props) {
  const focusRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (selected && focusSwordId) {
      focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [selected, focusSwordId]);

  return (
    <>
      <aside className={`atlas-sidebar ${selected ? 'is-open' : ''}`} aria-hidden={!selected}>
        {selected && (
          <div className="atlas-sidebar-inner">
            <button type="button" className="atlas-sidebar-close" onClick={onClose} aria-label="关闭侧栏">
              <X className="w-5 h-5" />
            </button>

            <header className="atlas-sidebar-head">
              <div className="font-brush text-4xl text-ink-900 tracking-widest">{selected.sect.name}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-700 font-song">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-cinnabar-600" />
                  {selected.sect.location}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Compass className="w-4 h-4 text-bronze-600" />
                  立派于 {selected.sect.foundingDynasty}
                </span>
              </div>
              {!selected.located && (
                <p className="atlas-lost-note">
                  驻地坐标已散佚，此门派暂无法绘上舆图，仅存文录于此。
                </p>
              )}
            </header>

            <p className="atlas-sidebar-desc">{selected.sect.description}</p>

            <section>
              <h3 className="atlas-sidebar-h">
                <Sparkles className="w-4 h-4 text-gold-600" /> 武功特色
              </h3>
              <div className="flex flex-wrap gap-2">
                {selected.sect.skills.map((s) => (
                  <span key={s} className="atlas-skill-tag">{s}</span>
                ))}
              </div>
            </section>

            <section>
              <h3 className="atlas-sidebar-h">
                <Swords className="w-4 h-4 text-cinnabar-600" /> 代表名剑
              </h3>
              {selected.swords.length === 0 && selected.missingSwordNames.length === 0 ? (
                <p className="atlas-empty-line">此门派不以剑术闻名，暂无关联名剑入谱。</p>
              ) : (
                <ul className="atlas-sword-list">
                  {selected.swords.map((sn) => (
                    <li key={sn.sword.id}>
                      <Link
                        ref={focusSwordId === sn.sword.id ? focusRef : undefined}
                        to={`/swords/${sn.sword.id}?from=atlas&sect=${selected.sect.id}`}
                        className={`atlas-sword-link ${focusSwordId === sn.sword.id ? 'is-focus' : ''}`}
                      >
                        <span className="font-brush text-2xl text-ink-900">{sn.sword.name}</span>
                        <span className="text-xs text-ink-600">{sn.sword.alias} · {sn.sword.dynasty}</span>
                        <span className="atlas-sword-go">观谱 ›</span>
                      </Link>
                    </li>
                  ))}
                  {selected.missingSwordNames.map((name) => (
                    <li key={name}>
                      <span className="atlas-sword-link is-lost" title="名剑谱尚未收录此剑">
                        <span className="font-brush text-2xl text-ink-400">{name}</span>
                        <span className="text-xs text-ink-400">名剑谱待录</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {selected.located && (
              <button type="button" className="atlas-locate-btn" onClick={() => onLocate(selected)}>
                在舆图上居中此门派
              </button>
            )}
          </div>
        )}
      </aside>

      {/* 坐标缺失的门派：踪迹不明 */}
      {model.missing.length > 0 && (
        <div className="atlas-missing">
          <div className="atlas-missing-title">踪迹不明（{model.missing.length}）</div>
          <div className="flex flex-wrap gap-2">
            {model.missing.map((sect) => (
              <button
                key={sect.id}
                type="button"
                className={`atlas-missing-chip ${selected?.sect.id === sect.id ? 'is-active' : ''}`}
                onClick={() => onSelectMissing(sect)}
                title={`${sect.location} · 立派于 ${sect.foundingDynasty}（坐标待考，无法绘上舆图）`}
              >
                {sect.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
