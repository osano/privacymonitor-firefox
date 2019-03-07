(function () {
    'use strict';

    const urls = {
        baseURL: 'https://api.privacymonitor.com',
        onInstalledURL: 'https://www.privacymonitor.com/welcome/firefox',
        onUninstallURL: 'https://www.privacymonitor.com/goodbye/firefox'
    };

    const expiration = {
        lastScoreExpirationDays: 30,
        noScoreExpirationDays: 1
    };

    localforage.config({
        driver: localforage.INDEXEDDB,
        name: 'PrivacyMonitor'
    });

    browser.runtime.setUninstallURL(urls.onUninstallURL);

    // event handlers
    browser.runtime.onMessage.addListener(function(message, sender, sendResponse){
        switch(message.msg) {
            case 'getPrivacyScore':
                getPrivacyScore(message, sender);
                break;
            case 'requestReview':
                requestReview(message, sender);
                break;
        }
    });

    browser.runtime.onInstalled.addListener(function (object) {
        if(object.reason === 'install'){
            browser.tabs.create({url: urls.onInstalledURL}, function (tab) {
                return;
            });
        }
    });

    browser.browserAction.onClicked.addListener(function(tab) {
        browser.tabs.sendMessage( tab.id, {
            message: 'ClickedOnIcon'
        })
    });

    function getPrivacyScore(message, sender) {
        const domain = extractRootDomain(sender.tab.url);

        if (domain !== undefined) {
            getPrivacyScoreLocal(message, sender.tab.id, domain, Date.now());
        }
    }

    function requestReview(message, sender) {
        const url = extractRootDomain(sender.tab.url);

        if (url !== undefined) {
            (async () => {
                fetch(urls.baseURL + '/analysis', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({domain: url})
                });
            })();


            browser.tabs.sendMessage(tabId, {
                message: 'saveScoreInLocalstorage',
                sentToAnalyze: true,
            })

        }
    }

    function getPrivacyScoreLocal(message, tabId, domain, now){
        localforage.getItem(domain).then(function(item) {
            if(item && item.score && !hasExpired(item.scoreDate, now)) {
                // domain score is available locally and has not gone stale
                sendDataToContentScript(tabId, domain, item, now);
            } else if(
                !item ||
                (item && !item.score && hasNoScoreAvailableExpired(item.scoreDate, now)) ||
                (item && item.score && hasExpired(item.scoreDate, now))
            ) {
                // domain score was not found
                // OR domain score was not found last time we checked
                // OR domain score has gone stale
                // fetch again
                getPrivacyScoreAPI(message, tabId, domain, now);
            } else {
                sendDomainNotFound(domain, tabId);
            }
        });
    }

    async function getPrivacyScoreAPI(message, tabId, domain, now) {
        await fetch(`${urls.baseURL}/score?q=${domain}`).then( response => {
            if(response.status === 404) {
                return null;
            } else if (response.ok) {
                return response.json();
            }

            throw new Error(`Unable to complete privacymonitor.com API request (HTTP ${response.status})`);
        }).then(result => {
            if (result) {
                const data = {
                    score: result.score,
                    previousScore: result.previousScore,
                    scoreDate: now,
                    lastAutoToastDate: now
                };

                storePrivacyScore(domain, data);

                sendDataToContentScript(tabId, domain, data, now);
            } else {
                const data = {
                    score: null,
                    previousScore: null,
                    scoreDate: now,
                    lastAutoToastDate: now
                };

                storePrivacyScore(domain, data);

                sendDomainNotFound(domain, tabId);
            }
        });
    }

    function sendDomainNotFound(domain, tabId) {
        browser.tabs.sendMessage( tabId, {
            message: 'NotFound',
            domain: domain
        });
    }

    function updateLastAutoToast(domain, now) {
        localforage.getItem(domain).then(function (item) {
            if(item !== null){
                item.lastAutoToastDate = now;
                localforage.setItem(domain, item );
            }
        });
    }

    function storePrivacyScore(domain, data) {
        localforage.setItem(domain, data);
    }

    function sendDataToContentScript(tabId, domain, data, now){
        browser.browserAction.setIcon({
            path : {
                '48': 'css/images/iconColored.png'
            },
            tabId : tabId
        });

        if(data.lastAutoToastDate === null || data.lastAutoToastDate === now || hasExpired(data.lastAutoToastDate, now)){
            updateLastAutoToast(domain, now);
            browser.tabs.sendMessage( tabId, {
                message: 'ActiveTabScore',
                score: data.score,
                previousScore: data.previousScore,
                domain: domain
            });
        } else {
            browser.tabs.sendMessage( tabId, {
                message: 'HiddenTabScore',
                score: data.score,
                previousScore: data.previousScore,
                domain: domain
            });
        }
    }

    function hasExpired(then, now) {
        const expireTime = Number(then) + (expiration.lastScoreExpirationDays * 86400 * 1000);
        return expireTime < now;
    }

    function hasNoScoreAvailableExpired(then, now) {
        const expireTime = Number(then) + (expiration.noScoreExpirationDays * 86400 * 1000);
        return expireTime < now;
    }

    function extractRootDomain(urlStr){
        const urlObj = new URL(urlStr);
        let domain = urlObj.hostname;
        const splitArr = domain.split('.');
        const arrLen = splitArr.length;
        if (arrLen > 2) {
            domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
            if ((splitArr[arrLen - 2].length === 2 &&
                splitArr[arrLen - 1].length === 2) || isTopLevelDomain(domain)) {
                domain = splitArr[arrLen - 3] + '.' + domain;
            }
        }
        return domain;
    }

    function isTopLevelDomain(url) {
        const tld = ['edu.ac', 'c.se', 'd.se', 'e.se', 'f.se', 'g.se', 'h.se', 'i.se', 'k.se', 'm.se', 'n.se', 'o.se', 's.se', 't.se', 'u.se', 'w.se', 'x.se', 'y.se', 'z.se', 'ac.ae', 'co.ag', 'co.ao', 'ed.ao', 'gv.ao', 'it.ao', 'og.ao', 'pb.ao', 'gv.at', 'ac.at', 'co.at', 'or.at', 'id.au', 'oz.au', 'nt.au', 'sa.au', 'wa.au', 'pp.az', 'ac.be', 'tv.bo', 'am.br', 'fm.br', 'tv.br', 'co.bw', 'ab.ca', 'bc.ca', 'mb.ca', 'nb.ca', 'nf.ca', 'nl.ca', 'ns.ca', 'nt.ca', 'nu.ca', 'on.ca', 'pe.ca', 'qc.ca', 'sk.ca', 'yk.ca', 'co.cc', 'co.ck', 'ac.cn', 'ah.cn', 'bj.cn', 'cq.cn', 'fj.cn', 'gd.cn', 'gs.cn', 'gz.cn', 'gx.cn', 'ha.cn', 'hb.cn', 'he.cn', 'hi.cn', 'hl.cn', 'hn.cn', 'jl.cn', 'js.cn', 'jx.cn', 'ln.cn', 'nm.cn', 'nx.cn', 'qh.cn', 'sc.cn', 'sd.cn', 'sh.cn', 'sn.cn', 'sx.cn', 'tj.cn', 'xj.cn', 'xz.cn', 'yn.cn', 'zj.cn', 'us.com', 'ac.cr', 'co.cr', 'ed.cr', 'fi.cr', 'go.cr', 'or.cr', 'sa.cr', 'tm.cy', 'ac.cy', 'ac.fj', 'co.fk', 'ac.fk', 'tm.fr', 'co.gg', 'ac.gn', 'iz.hr', 'co.hu', 'tm.hu', 'ac.id', 'co.id', 'or.id', 'go.id', 'ac.il', 'co.il', 'co.im', 'ac.im', 'co.in', 'ac.in', 'ac.ir', 'co.ir', 'co.je', 'ac.jp', 'ad.jp', 'co.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr', 'co.ls', 'id.lv', 'id.ly', 'co.ma', 'tm.mc', 'tm.mg', 'co.mu', 'ac.mw', 'co.mw', 'ac.nz', 'co.nz', 'co.om', 'ac.com', 'ac.pa', 'tm.ro', 'nt.ro', 'pp.ru', 'ac.ru', 'ac.rw', 'co.rw', 'tv.sd', 'pp.se', 'tm.se', 'fh.se', 'ab.se', 'ac.se', 'bd.se', 'ac.th', 'co.th', 'in.th', 'go.th', 'mi.th', 'or.th', 'ac.tj', 'co.tj', 'go.tj', 'av.tr', 'dr.tr', 'co.tt', 'co.tz', 'ac.tz', 'go.tz', 'or.tz', 'ne.tz', 'ck.ua', 'cn.ua', 'cv.ua', 'dp.ua', 'dn.ua', 'if.ua', 'kh.ua', 'ks.ua', 'km.ua', 'kv.ua', 'kr.ua', 'lg.ua', 'mk.ua', 'od.ua', 'pl.ua', 'rv.ua', 'te.ua', 'vn.ua', 'zp.ua', 'zt.ua', 'co.ug', 'ac.ug', 'sc.ug', 'go.ug', 'ne.ug', 'or.ug', 'ac.uk', 'co.uk', 'me.uk', 'bl.uk', 'ak.us', 'al.us', 'ar.us', 'az.us', 'ca.us', 'co.us', 'ct.us', 'dc.us', 'de.us', 'fl.us', 'ga.us', 'hi.us', 'ia.us', 'id.us', 'il.us', 'in.us', 'ks.us', 'ky.us', 'la.us', 'ma.us', 'md.us', 'me.us', 'mi.us', 'mn.us', 'mo.us', 'ms.us', 'mt.us', 'nc.us', 'nd.us', 'ne.us', 'nh.us', 'nj.us', 'nm.us', 'nv.us', 'ny.us', 'oh.us', 'ok.us', 'or.us', 'pa.us', 'ri.us', 'sc.us', 'sd.us', 'tn.us', 'tx.us', 'ut.us', 'vt.us', 'va.us', 'wa.us', 'wi.us', 'wv.us', 'wy.us', 'co.ve', 'ac.vn', 'ac.yu', 'co.yu', 'ac.za', 'co.za', 'tm.za', 'co.zm', 'ac.zm', 'co.zw', 'ac.zw', 'gov.ac', 'net.ac', 'mil.ac', 'org.ac', 'nom.ad', 'net.ae', 'gov.ae', 'org.ae', 'mil.ae', 'sch.ae', 'pro.ae', 'gov.af', 'edu.af', 'net.af', 'com.af', 'com.ag', 'org.ag', 'net.ag', 'nom.ag', 'off.ai', 'com.ai', 'net.ai', 'org.ai', 'gov.al', 'edu.al', 'org.al', 'com.al', 'net.al', 'upt.al', 'com.an', 'net.an', 'org.an', 'edu.an', 'com.ar', 'gov.ar', 'int.ar', 'mil.ar', 'net.ar', 'org.ar', 'ip6.arpa', 'uri.arpa', 'urn.arpa', 'asn.au', 'com.au', 'net.au', 'org.au', 'act.au', 'nsw.au', 'qld.au', 'tas.au', 'vic.au', 'gov.au', 'edu.au:', 'com.aw', 'com.az', 'net.az', 'int.az', 'gov.az', 'biz.az', 'org.az', 'edu.az', 'mil.az', 'com.bb', 'edu.bb', 'gov.bb', 'net.bb', 'org.bb', 'com.bd', 'edu.bd', 'net.bd', 'gov.bd', 'org.bd', 'mil.bd', 'gov.bf', 'com.bm', 'edu.bm', 'org.bm', 'gov.bm', 'net.bm', 'com.bn', 'edu.bn', 'org.bn', 'net.bn', 'com.bo', 'org.bo', 'net.bo', 'gov.bo', 'gob.bo', 'edu.bo', 'mil.bo', 'int.bo', 'agr.br', 'art.br', 'edu.br', 'com.br', 'esp.br', 'far.br', 'g12.br', 'gov.br', 'imb.br', 'ind.br', 'inf.br', 'mil.br', 'net.br', 'org.br', 'psi.br', 'rec.br', 'srv.br', 'tmp.br', 'tur.br', 'etc.br', 'adm.br', 'adv.br', 'arq.br', 'ato.br', 'bio.br', 'bmd.br', 'cim.br', 'cng.br', 'cnt.br', 'ecn.br', 'eng.br', 'eti.br', 'fnd.br', 'fot.br', 'fst.br', 'ggf.br', 'jor.br', 'lel.br', 'mat.br', 'med.br', 'mus.br', 'not.br', 'ntr.br', 'odo.br', 'ppg.br', 'pro.br', 'psc.br', 'qsl.br', 'slg.br', 'trd.br', 'vet.br', 'zlg.br', 'dpn.br', 'nom.br', 'com.bs', 'net.bs', 'org.bs', 'com.bt', 'edu.bt', 'gov.bt', 'net.bt', 'org.bt', 'org.bw', 'gov.by', 'mil.by', 'com.cd', 'net.cd', 'org.cd', 'com.ch', 'net.ch', 'org.ch', 'gov.ch', 'com.cn', 'edu.cn', 'gov.cn', 'net.cn', 'org.cn', 'com.co', 'edu.co', 'org.co', 'gov.co', 'mil.co', 'net.co', 'nom.co', 'com.cu', 'edu.cu', 'org.cu', 'net.cu', 'gov.cu', 'inf.cu', 'gov.cx', 'com.cy', 'biz.cy', 'ltd.cy', 'pro.cy', 'net.cy', 'org.cy', 'com.dm', 'net.dm', 'org.dm', 'edu.dm', 'gov.dm', 'edu.do', 'gov.do', 'gob.do', 'com.do', 'org.do', 'sld.do', 'web.do', 'net.do', 'mil.do', 'art.do', 'com.dz', 'org.dz', 'net.dz', 'gov.dz', 'edu.dz', 'pol.dz', 'art.dz', 'com.ec', 'net.ec', 'fin.ec', 'med.ec', 'pro.ec', 'org.ec', 'edu.ec', 'gov.ec', 'mil.ec', 'com.ee', 'org.ee', 'fie.ee', 'pri.ee', 'eun.eg', 'edu.eg', 'sci.eg', 'gov.eg', 'com.eg', 'org.eg', 'net.eg', 'mil.eg', 'com.es', 'nom.es', 'org.es', 'gob.es', 'edu.es', 'com.et', 'gov.et', 'org.et', 'edu.et', 'net.et', 'biz.et', 'biz.fj', 'com.fj', 'net.fj', 'org.fj', 'pro.fj', 'gov.fj', 'mil.fj', 'org.fk', 'gov.fk', 'nom.fk', 'net.fk', 'nom.fr', 'prd.fr', 'com.fr', 'com.ge', 'edu.ge', 'gov.ge', 'org.ge', 'mil.ge', 'net.ge', 'pvt.ge', 'net.gg', 'org.gg', 'com.gh', 'edu.gh', 'gov.gh', 'org.gh', 'mil.gh', 'com.gi', 'ltd.gi', 'gov.gi', 'mod.gi', 'edu.gi', 'org.gi', 'com.gn', 'gov.gn', 'org.gn', 'net.gn', 'com.gp', 'net.gp', 'edu.gp', 'org.gp', 'com.gr', 'edu.gr', 'net.gr', 'org.gr', 'gov.gr', 'com.hk', 'edu.hk', 'gov.hk', 'idv.hk', 'net.hk', 'org.hk', 'com.hn', 'edu.hn', 'org.hn', 'net.hn', 'mil.hn', 'gob.hn', 'com.hr', 'com.ht', 'net.ht', 'pro.ht', 'org.ht', 'art.ht', 'pol.ht', 'rel.ht', 'med.ht', 'edu.ht', 'org.hu', 'sex.hu', 'gov.ie', 'org.il', 'net.il', 'k12.il', 'gov.il', 'idf.il', 'ltd.co.im', 'plc.co.im', 'net.im', 'gov.im', 'org.im', 'nic.im', 'net.in', 'org.in', 'gen.in', 'ind.in', 'nic.in', 'edu.in', 'res.in', 'gov.in', 'mil.in', 'gov.ir', 'net.ir', 'org.ir', 'sch.ir', 'gov.it', 'net.je', 'org.je', 'edu.jm', 'gov.jm', 'com.jm', 'net.jm', 'org.jm', 'com.jo', 'org.jo', 'net.jo', 'edu.jo', 'gov.jo', 'mil.jo', 'mie.jp', 'per.kh', 'com.kh', 'edu.kh', 'gov.kh', 'mil.kh', 'net.kh', 'org.kh', 'com.kw', 'edu.kw', 'gov.kw', 'net.kw', 'org.kw', 'mil.kw', 'edu.ky', 'gov.ky', 'com.ky', 'org.ky', 'net.ky', 'org.kz', 'edu.kz', 'net.kz', 'gov.kz', 'mil.kz', 'com.kz', 'net.lb', 'org.lb', 'gov.lb', 'edu.lb', 'com.lb', 'com.lc', 'org.lc', 'edu.lc', 'gov.lc', 'com.li', 'net.li', 'org.li', 'gov.li', 'gov.lk', 'sch.lk', 'net.lk', 'int.lk', 'com.lk', 'org.lk', 'edu.lk', 'ngo.lk', 'soc.lk', 'web.lk', 'ltd.lk', 'grp.lk', 'com.lr', 'edu.lr', 'gov.lr', 'org.lr', 'net.lr', 'org.ls', 'gov.lt', 'mil.lt', 'gov.lu', 'mil.lu', 'org.lu', 'net.lu', 'com.lv', 'edu.lv', 'gov.lv', 'org.lv', 'mil.lv', 'net.lv', 'asn.lv', 'com.ly', 'net.ly', 'gov.ly', 'plc.ly', 'edu.ly', 'sch.ly', 'med.ly', 'org.ly', 'net.ma', 'gov.ma', 'org.ma', 'org.mg', 'nom.mg', 'gov.mg', 'prd.mg', 'com.mg', 'edu.mg', 'mil.mg', 'com.mk', 'org.mk', 'com.mo', 'net.mo', 'org.mo', 'edu.mo', 'gov.mo', 'org.mt', 'com.mt', 'gov.mt', 'edu.mt', 'net.mt', 'com.mu', 'biz.mv', 'com.mv', 'edu.mv', 'gov.mv', 'int.mv', 'mil.mv', 'net.mv', 'org.mv', 'pro.mv', 'com.mw', 'edu.mw', 'gov.mw', 'int.mw', 'net.mw', 'org.mw', 'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx', 'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my', 'mil.my', 'edu.ng', 'com.ng', 'gov.ng', 'org.ng', 'net.ng', 'gob.ni', 'com.ni', 'edu.ni', 'org.ni', 'nom.ni', 'net.ni', 'mil.no', 'vgs.no', 'fhs.no', 'com.np', 'org.np', 'edu.np', 'net.np', 'gov.np', 'mil.np', 'gov.nr', 'edu.nr', 'biz.nr', 'org.nr', 'com.nr', 'net.nr', 'cri.nz', 'gen.nz', 'iwi.nz', 'mil.nz', 'net.nz', 'org.nz', 'com.om', 'edu.om', 'sch.om', 'gov.om', 'net.om', 'org.om', 'mil.om', 'biz.om', 'pro.om', 'med.om', 'com.pa', 'sld.pa', 'gob.pa', 'edu.pa', 'org.pa', 'net.pa', 'abo.pa', 'ing.pa', 'med.pa', 'nom.pa', 'com.pe', 'org.pe', 'net.pe', 'edu.pe', 'mil.pe', 'gob.pe', 'nom.pe', 'com.pf', 'org.pf', 'edu.pf', 'com.pg', 'net.pg', 'com.ph', 'gov.ph', 'com.pk', 'net.pk', 'edu.pk', 'org.pk', 'fam.pk', 'biz.pk', 'web.pk', 'gov.pk', 'gob.pk', 'gok.pk', 'gon.pk', 'gop.pk', 'gos.pk', 'com.pl', 'biz.pl', 'net.pl', 'art.pl', 'edu.pl', 'org.pl', 'ngo.pl', 'gov.pl', 'mil.pl', 'waw.pl', 'gda.pl', 'biz.pr', 'com.pr', 'edu.pr', 'gov.pr', 'net.pr', 'org.pr', 'pro.pr', 'law.pro', 'med.pro', 'cpa.pro', 'edu.ps', 'gov.ps', 'sec.ps', 'plo.ps', 'com.ps', 'org.ps', 'net.ps', 'com.pt', 'edu.pt', 'gov.pt', 'int.pt', 'net.pt', 'org.pt', 'net.py', 'org.py', 'gov.py', 'edu.py', 'com.py', 'com.ro', 'org.ro', 'nom.ro', 'rec.ro', 'www.ro', 'com.ru', 'net.ru', 'org.ru', 'msk.ru', 'int.ru', 'gov.rw', 'net.rw', 'edu.rw', 'com.rw', 'int.rw', 'mil.rw', 'gov.rw', 'com.sa', 'edu.sa', 'sch.sa', 'med.sa', 'gov.sa', 'net.sa', 'org.sa', 'pub.sa', 'com.sb', 'gov.sb', 'net.sb', 'edu.sb', 'com.sc', 'gov.sc', 'net.sc', 'org.sc', 'edu.sc', 'com.sd', 'net.sd', 'org.sd', 'edu.sd', 'med.sd', 'gov.sd', 'org.se', 'fhv.se', 'mil.se', 'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg', 'per.sg', 'idn.sg', 'edu.sv', 'com.sv', 'gob.sv', 'org.sv', 'red.sv', 'gov.sy', 'com.sy', 'net.sy', 'net.th', 'biz.tj', 'com.tj', 'edu.tj', 'int.tj', 'net.tj', 'org.tj', 'web.tj', 'gov.tj', 'mil.tj', 'com.tn', 'gov.tn', 'org.tn', 'ind.tn', 'nat.tn', 'ens.tn', 'fin.tn', 'net.tn', 'gov.to', 'gov.tp', 'com.tr', 'biz.tr', 'net.tr', 'org.tr', 'web.tr', 'gen.tr', 'bbs.tr', 'tel.tr', 'gov.tr', 'bel.tr', 'pol.tr', 'mil.tr', 'k12.tr', 'edu.tr', 'com.tt', 'org.tt', 'net.tt', 'biz.tt', 'pro.tt', 'edu.tt', 'gov.tt', 'gov.tv', 'edu.tw', 'gov.tw', 'mil.tw', 'com.tw', 'net.tw', 'org.tw', 'idv.tw', 'com.ua', 'gov.ua', 'net.ua', 'edu.ua', 'org.ua', 'gov.uk', 'ltd.uk', 'mil.uk', 'mod.uk', 'net.uk', 'nic.uk', 'nhs.uk', 'org.uk', 'plc.uk', 'sch.uk', 'jet.uk', 'nel.uk', 'nls.uk', 'sch.uk', 'dni.us', 'fed.us', 'isa.us', 'nsn.us', 'edu.uy', 'gub.uy', 'org.uy', 'com.uy', 'net.uy', 'mil.uy', 'com.ve', 'net.ve', 'org.ve', 'web.ve', 'com.vi', 'org.vi', 'edu.vi', 'gov.vi', 'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn', 'int.vn', 'biz.vn', 'pro.vn', 'com.ye', 'net.ye', 'org.yu', 'edu.yu', 'edu.za', 'gov.za', 'law.za', 'mil.za', 'nom.za', 'org.za', 'alt.za', 'net.za', 'ngo.za', 'web.za', 'org.zm', 'gov.zm', 'sch.zm', 'org.zw', 'gov.zw', 'name.ae', 'e164.arpa', 'iris.arpa', 'priv.at', 'info.au', 'conf.au', 'name.az', 'info.az', 'coop.br', 'info.cy', 'name.cy', 'asso.dz', 'info.ec', 'name.et', 'info.et', 'info.fj', 'name.fj', 'asso.fr', 'gouv.fr', 'asso.gp', 'from.hr', 'name.hr', 'firm.ht', 'shop.ht', 'info.ht', 'asso.ht', 'coop.ht', 'gouv.ht', 'info.hu', 'priv.hu', '2000.hu', 'bolt.hu', 'city.hu', 'film.hu', 'news.hu', 'shop.hu', 'suli.hu', 'szex.hu', 'muni.il', 'firm.in', 'gifu.jp', 'nara.jp', 'saga.jp', 'oita.jp', 'kobe.jp', 'assn.lk', 'conf.lv', 'asso.mc', 'army.mil', 'navy.mil', 'aero.mv', 'coop.mv', 'info.mv', 'name.mv', 'coop.mw', 'name.my', 'stat.no', 'priv.no', 'info.nr', 'geek.nz', 'govt.nz', 'info.pl', 'wroc.pl', 'lodz.pl', 'info.pr', 'isla.pr', 'name.pr', 'nome.pt', 'publ.pt', 'info.ro', 'arts.ro', 'firm.ro', 'info.sd', 'sshn.se', 'fhsk.se', 'name.tj', 'intl.tn', 'info.tn', 'info.tr', 'name.tr', 'info.tt', 'name.tt', 'game.tw', 'ebiz.tw', 'club.tw', 'kiev.ua', 'lviv.ua', 'sumy.ua', 'kids.us', 'info.ve', 'info.vn', 'name.vn', 'city.za', 'uniti.al', 'soros.al', 'inima.al', 'csiro.au', 'press.cy', 'aland.fi', 'adult.ht', 'perso.ht', 'sport.hu', 'agrar.hu', 'forum.hu', 'games.hu', 'hotel.hu', 'lakas.hu', 'media.hu', 'video.hu', 'iwate.jp', 'akita.jp', 'gunma.jp', 'chiba.jp', 'tokyo.jp', 'fukui.jp', 'aichi.jp', 'shiga.jp', 'kyoto.jp', 'osaka.jp', 'hyogo.jp', 'ehime.jp', 'kochi.jp', 'hotel.lk', 'music.mobi', 'herad.no', 'maori.nz', 'store.ro', 'brand.se', 'parti.se', 'press.se', 'lutsk.ua', 'rovno.ua', 'icnet.uk', 'tirana.al', 'school.fj', 'presse.fr', 'casino.hu', 'jogasz.hu', 'reklam.hu', 'tozsde.hu', 'utazas.hu', 'aomori.jp', 'miyagi.jp', 'toyama.jp', 'nagano.jp', 'kagawa.jp', 'sendai.jp', 'nagoya.jp', 'museum.mv', 'museum.mw', 'museum.no', 'idrett.no', 'school.nz', 'museum.om', 'krakow.pl', 'poznan.pl', 'gdansk.pl', 'slupsk.pl', 'lublin.pl', 'komvux.se', 'lanarb.se', 'lanbib.se', 'crimea.ua', 'odessa.ua', 'police.uk', 'health.vn', 'school.za', 'in-addr.arpa', 'ekloges.cy', 'erotica.hu', 'erotika.hu', 'ibaraki.jp', 'tochigi.jp', 'saitama.jp', 'niigata.jp', 'tottori.jp', 'shimane.jp', 'okayama.jp', 'fukuoka.jp', 'okinawa.jp', 'sapporo.jp', 'weather.mobi', 'kommune.no', 'wroclaw.pl', 'olsztyn.pl.torun.pl', 'komforb.se', 'tourism.tn', 'donetsk.ua', 'kharkov.ua', 'kherson.ua', 'lugansk.ua', 'poltava.ua', 'vinnica.ua', 'vatican.va', 'ingatlan.hu', 'konyvelo.hu', 'hokkaido.jp', 'yamagata.jp', 'kanagawa.jp', 'ishikawa.jp', 'shizuoka.jp', 'wakayama.jp', 'nagasaki.jp', 'kumamoto.jp', 'miyazaki.jp', 'yokohama.jp', 'kawasaki.jp', 'warszawa.pl', 'szczecin.pl', 'nikolaev.ua', 'ternopil.ua', 'uzhgorod.ua', 'zhitomir.ua', 'fukushima.jp', 'yamanashi.jp', 'hiroshima.jp', 'yamaguchi.jp', 'tokushima.jp', 'kagoshima.jp', 'folkebibl.no', 'bialystok.pl', 'cherkassy.ua', 'chernigov.ua', 'parliament.cy', 'kitakyushu.jp', 'fylkesbibl.no', 'chernovtsy.ua', 'kirovograd.ua', 'sebastopol.ua', 'parliament.uk', 'zaporizhzhe.ua', 'khmelnitskiy.ua', 'naturbruksgymn.se', 'dnepropetrovsk.ua', 'kommunalforbund.se', 'ivano-frankivsk.ua', 'british-library.uk', 'national-library-scotland.uk', ];
        return tld.includes(url);
    }
}());