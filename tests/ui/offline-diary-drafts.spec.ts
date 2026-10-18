import {test,expect} from '@playwright/test';
import {setup,id} from './fixtures';

test('field note draft is device-local until manually sent to diary',async({page})=>{
 const state=await setup(page);
 await page.goto('/fields/'+id+'/history');
 const drafts=page.getByRole('region',{name:'Offline field-note drafts'});
 await expect(drafts).toBeVisible();
 await drafts.getByLabel('Offline note text').fill('Irrigation observed at the north edge');
 await drafts.getByRole('button',{name:'Save offline draft'}).click();
 await expect(drafts).toContainText('Irrigation observed at the north edge');
 expect(state.events).toHaveLength(0);
 await page.reload();
 await expect(drafts).toContainText('Irrigation observed at the north edge');
 page.once('dialog',dialog=>void dialog.accept());
 await drafts.getByRole('button',{name:'Send to diary'}).click();
 await expect(page.locator('.history-event')).toContainText('Irrigation observed at the north edge');
 await expect(drafts).toContainText('No offline drafts saved.');
 expect(state.events).toHaveLength(1);
});

test('offline drafts can be edited and deleted without server requests',async({page})=>{
 const state=await setup(page);
 await page.goto('/fields/'+id+'/history');
 const drafts=page.getByRole('region',{name:'Offline field-note drafts'});
 await drafts.getByLabel('Offline note text').fill('First local note');
 await drafts.getByRole('button',{name:'Save offline draft'}).click();
 await drafts.getByRole('button',{name:'Edit'}).click();
 await drafts.getByLabel('Offline note text').fill('Updated local note');
 await drafts.getByRole('button',{name:'Update local draft'}).click();
 await expect(drafts).toContainText('Updated local note');
 page.once('dialog',dialog=>void dialog.accept());
 await drafts.getByRole('button',{name:'Delete draft'}).click();
 await expect(drafts).toContainText('No offline drafts saved.');
 expect(state.events).toHaveLength(0);
});
