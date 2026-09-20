import { X, MapPin, Landmark, Sparkles, Sword as SwordIcon, ChevronRight } from 'lucide-react';
import type { Sect, Sword } from '@/types';

interface MapSidebarProps {
  sect: Sect | null;
  /** 已匹配到名剑录的剑（可跳转详情） */
  swords: Sword[];
  onClose: () => void;
  onOpenSword: (id: string) => void;
}

export default function MapSidebar({ sect, swords, onClose, onOpenSword }: MapSidebarProps) {
  if (!sect) return null;

  const matched = new Map(swords.map((s) => [s.name, s]));

  return (
    <aside className="absolute bottom-0 left-0 right-0 z-30 max-h-[46%] overflow-y-auto border-t border-ink-300 bg-ink-50/95 shadow-ink backdrop-blur-sm md:bottom-auto md:left-auto md:right-0 md:top-0 md:h-full md:max-h-none md:w-80 md:border-l md:border-t-0">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-brush text-3xl text-ink-900">{sect.name}</h2>
            <p className="mt-1 flex items-center gap-1 font-song text-xs text-ink-600">
              <MapPin className="h-3.5 w-3.5 text-cinnabar-600" />
              {sect.location}
            </p>
            <p className="mt-0.5 flex items-center gap-1 font-song text-xs text-ink-600">
              <Landmark className="h-3.5 w-3.5 text-cinnabar-600" />
              立派于{sect.foundingDynasty}朝
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-ink-500 transition-colors hover:text-cinnabar-600"
            aria-label="关闭门派详情"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-3 font-song text-sm leading-relaxed text-ink-700">{sect.description}</p>

        <div className="ink-divider" />

        <h3 className="flex items-center gap-1.5 font-song text-sm font-semibold text-ink-900">
          <Sparkles className="h-4 w-4 text-gold-600" />
          武功特色
        </h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {sect.skills.map((skill) => (
            <span
              key={skill}
              className="border border-ink-300 bg-ink-100 px-2.5 py-1 font-song text-xs text-ink-700"
            >
              {skill}
            </span>
          ))}
        </div>

        <div className="ink-divider" />

        <h3 className="flex items-center gap-1.5 font-song text-sm font-semibold text-ink-900">
          <SwordIcon className="h-4 w-4 text-gold-600" />
          代表名剑
        </h3>
        {sect.notableSwords.length === 0 ? (
          <p className="mt-2 font-song text-xs text-ink-500">此门派暂无关联名剑收录。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {sect.notableSwords.map((name) => {
              const sword = matched.get(name);
              if (!sword) {
                return (
                  <li
                    key={name}
                    className="flex items-center justify-between border border-ink-200 bg-ink-100/60 px-3 py-2"
                  >
                    <span className="font-song text-sm text-ink-500">{name}</span>
                    <span className="font-song text-[10px] text-ink-400">名剑录未收录</span>
                  </li>
                );
              }
              return (
                <li key={name}>
                  <button
                    onClick={() => onOpenSword(sword.id)}
                    className="group flex w-full items-center justify-between border border-ink-200 bg-ink-100 px-3 py-2 text-left transition-colors hover:border-gold-500 hover:bg-gold-50"
                  >
                    <span>
                      <span className="font-song text-sm text-ink-900">{sword.name}</span>
                      <span className="ml-2 font-song text-[10px] text-ink-500">
                        {sword.alias} · {sword.dynasty}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-cinnabar-600" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
