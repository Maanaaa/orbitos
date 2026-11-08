import { useEffect, useState } from 'react';
import { Segmented } from '../os/ui';
import type { AppProps } from './registry';
import HostingApps from './HostingApps';
import Sites from './Sites';

type Tab = 'apps' | 'sites';

/** Hébergement : applications (jeux, vocal, bots, conteneurs) et sites web depuis GitHub. */
export default function Hosting({ win }: AppProps) {
  const [tab, setTab] = useState<Tab>(win.props.tab || 'apps');
  useEffect(() => {
    if (win.props.tab) setTab(win.props.tab);
  }, [win.props.nonce, win.props.tab]);
  const switcher = (
    <Segmented
      value={tab}
      onChange={setTab}
      options={[
        { value: 'apps', label: 'Applications' },
        { value: 'sites', label: 'Sites web' },
      ]}
    />
  );
  return tab === 'apps' ? <HostingApps switcher={switcher} /> : <Sites win={win} switcher={switcher} />;
}
