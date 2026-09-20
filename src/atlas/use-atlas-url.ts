/**
 * 舆图视口状态：唯一来源是 URL。
 *
 * 设计要点：
 *  - 视口（x/y/z）在手势过程中高频 replaceState，不入 React state，
 *    因此 rAF / pointermove 写 transform 永远不会触发 setState；
 *  - 手势「开始」时 push 一条当前视角的历史项，结束时收口，
 *    浏览器后退即可回到手势前视角；
 *  - popstate 是外部视角变化（后退/前进）的唯一通知渠道，
 *    回调交给画布做飞行补间。
 */

import { useCallback, useEffect, useRef } from 'react';
import { parseUrlState } from '@/atlas/url-state';
import type { UrlState } from '@/atlas/url-state';

interface Handlers {
  onViewChanged: (state: UrlState) => void;
  onSelectionChanged: (state: UrlState) => void;
}

export function readState(): UrlState {
  return parseUrlState(window.location.search);
}

export function useAtlasUrl(handlers: Handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  /**
   * 手势开始：把「手势前视角」固化为一条历史项。
   * 之后高频 live 替换的是新条目，回退时自然落回旧视角。
   */
  const beginGesture = useCallback(() => {
    const url = window.location.pathname + window.location.search;
    window.history.pushState(null, '', url);
  }, []);

  /** 手势中：高频但由调用方节流地替换当前 URL（不入历史） */
  const liveReplace = useCallback((search: string) => {
    window.history.replaceState(null, '', window.location.pathname + search);
  }, []);

  /** 手势结束 / 离散操作（键盘、缩略图）：提交最终视角 */
  const commitReplace = useCallback((search: string) => {
    window.history.replaceState(null, '', window.location.pathname + search);
  }, []);

  /** 离散跳转（重置、点选门派、侧栏跳转名剑）：新增历史项，可后退 */
  const commitPush = useCallback((search: string) => {
    window.history.pushState(null, '', window.location.pathname + search);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const state = readState();
      handlersRef.current.onViewChanged(state);
      handlersRef.current.onSelectionChanged(state);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return { beginGesture, liveReplace, commitReplace, commitPush };
}
