"use strict";var $=Object.create;var x=Object.defineProperty;var F=Object.getOwnPropertyDescriptor;var R=Object.getOwnPropertyNames;var T=Object.getPrototypeOf,k=Object.prototype.hasOwnProperty;var P=(e,t,o,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of R(t))!k.call(e,r)&&r!==o&&x(e,r,{get:()=>t[r],enumerable:!(i=F(t,r))||i.enumerable});return e};var m=(e,t,o)=>(o=e!=null?$(T(e)):{},P(t||!e||!e.__esModule?x(o,"default",{value:e,enumerable:!0}):o,e));var w=m(require("@actions/core")),n=m(require("@actions/github")),s=m(require("semver")),a=m(require("@actions/exec")),c=m(require("fs/promises")),f=n.getOctokit(w.getInput("token")),q=/\d+\.\d+\.\d+(-.*)?/,d="internal@elementor.com";async function b(){let e=n.context.ref.replace("refs/heads/","");if(!s.parse(e)&&!s.parse(e+".0")||(await f.request("GET /repos/{owner}/{repo}/commits/{sha}",{owner:n.context.repo.owner,repo:n.context.repo.repo,sha:n.context.sha})).data.commit.author.email===d)return;let o=await f.request("GET /repos/{owner}/{repo}/commits/{sha}",{owner:n.context.repo.owner,repo:n.context.repo.repo,sha:n.context.sha,headers:{accept:"application/vnd.github.diff"}});if(!o.data)return;let i=I(o.data),r=E(i);if(!r)return;let h=(await f.request("GET /repos/{owner}/{repo}/branches",{owner:n.context.repo.owner,repo:n.context.repo.repo})).data.filter(g=>{let l=s.parse(g.name+".0");return l&&s.gt(l.version,r)}).map(g=>g.name);h.push("main");let v=await c.readFile("changelog.txt"),p;n.context.repo.repo==="elementor"&&(p=await c.readFile("readme.txt"));for(let g of h)await C(e,g,v,p)}async function C(e,t,o,i){let r=`changelog-${e}-to-${t}`,u=`Internal: Changelog v${e} to ${t} (automatic)`;await a.exec("git fetch --all"),await a.exec(`git checkout ${t}`),await a.exec("git pull"),await a.exec('git config user.name "elementor internal"'),await a.exec(`git config user.email ${d}`),await a.exec(`git reset --hard origin/${t}`),i&&await c.writeFile("readme.txt",i),await c.writeFile("changelog.txt",o),await a.exec(`git checkout -b ${r}`),await a.exec("git add changelog.txt readme.txt"),await a.exec(`git commit -m "${u}"`),await a.exec(`git push --set-upstream origin ${r}`),await f.request("POST /repos/{owner}/{repo}/pulls",{owner:n.context.repo.owner,repo:n.context.repo.repo,title:u,head:r,base:t})}function E(e){if(e.length===0)return;let t=e[0];for(let o of e)s.lt(o,t)&&(t=o);return t}function I(e){let t=e.split(`
`),o=[],i;for(let r of t)r.startsWith("+")&&r.startsWith("+#")&&(i=O(r),i&&o.push(i));return o}function O(e){let t=q.exec(e);if(t&&t.length>0)return t[0]}b();
