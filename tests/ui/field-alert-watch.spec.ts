import {test,expect} from '@playwright/test';
import {setup} from './fixtures';

test('alert watch is opt-in and existing reminder stays present',async({page})=>{
 await setup(page);
 await page.goto('/');
 const region=page.getByRole('region',{name:'Automatic field alert watcher'});
 await expect(region).toBeVisible();
 await expect(region.getByText('Opt in to check open satellite alerts', {exact:false})).toBeVisible();
 await expect(page.getByRole('region',{name:'Field visit notifications'})).toBeVisible();
 await expect(region.getByRole('button',{name:'Enable alert watch'})).toBeVisible();
 await expect(region.getByRole('button',{name:'Check now'})).toHaveCount(0);
});

test('showcase warns rather than issuing live field notifications',async({page})=>{
 await page.goto('/?demo=1');
 const region=page.getByRole('region',{name:'Automatic field alert watcher'});
 await expect(region).toBeVisible();
 const enable=region.getByRole('button',{name:'Enable alert watch'});
 if(await enable.isVisible()){
  await enable.click();
  await expect(region).toContainText('Sample mode does not send real field notifications.');
 }
});
