import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/src',{recursive:true});
await copyFile('index.html','dist/index.html');
await copyFile('styles.css','dist/styles.css');
await cp('src','dist/src',{recursive:true});
console.log('Build completed: static application copied to dist/.');
